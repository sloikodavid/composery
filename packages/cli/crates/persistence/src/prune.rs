use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[cfg(unix)]
use std::{collections::BTreeSet, fs, path::Path};

#[cfg(unix)]
use crate::{
    baseline::BaselineDb,
    config::Config,
    internal::StateDb,
    metadata,
    paths::Paths,
    public, rootfs,
    update::{self, UpdateContext, UpdateOutcome},
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneReport {
    pub removed: Vec<String>,
    pub skipped: Vec<String>,
}

#[cfg(unix)]
pub fn run(
    root: &Path,
    paths: &Paths,
    config: &Config,
    baseline: &BaselineDb,
    db: &StateDb,
) -> Result<PruneReport> {
    let mut report = PruneReport {
        removed: Vec::new(),
        skipped: Vec::new(),
    };

    prune_baseline_equal_changed(root, paths, config, baseline, &mut report)?;
    prune_stale_tombstones(paths, config, baseline, &mut report)?;
    prune_stale_metadata(root, paths, config, baseline, &mut report)?;
    prune_empty_changed_dirs(root, paths, config, baseline, &mut report)?;
    prune_empty_removed_dirs(paths, config, &mut report)?;
    db.rebuild_public_index(paths)?;
    Ok(report)
}

#[cfg(not(unix))]
pub fn run(_paths: &crate::paths::Paths, _db: &crate::internal::StateDb) -> Result<PruneReport> {
    Ok(PruneReport {
        removed: Vec::new(),
        skipped: vec!["prune is only supported on Unix".into()],
    })
}

#[cfg(unix)]
fn prune_baseline_equal_changed(
    root: &Path,
    paths: &Paths,
    config: &Config,
    baseline: &BaselineDb,
    report: &mut PruneReport,
) -> Result<()> {
    let ctx = UpdateContext {
        root,
        paths,
        config,
        baseline,
    };
    let mut store = metadata::MetadataStore::load(&paths.metadata_file)?;

    for entry in public::list_public_entries(&paths.changed_dir)? {
        if public::is_excluded(&entry.path, config) {
            report.skipped.push(format!("excluded {}", entry.path));
            continue;
        }
        if matches!(
            update::update_public_path(&ctx, &mut store, &entry.path)?,
            UpdateOutcome::Pruned
        ) {
            report
                .removed
                .push(format!("baseline-equal changed {}", entry.path));
        }
    }
    store.flush()?;
    Ok(())
}

#[cfg(unix)]
fn prune_stale_tombstones(
    paths: &Paths,
    config: &Config,
    baseline: &BaselineDb,
    report: &mut PruneReport,
) -> Result<()> {
    for public_path in public::list_public_file_paths(&paths.removed_dir)? {
        if public::is_excluded(&public_path, config) {
            report.skipped.push(format!("excluded {}", public_path));
            continue;
        }
        if baseline.get(&public_path)?.is_none()
            && !exists_no_follow(&public_path.destination(&paths.changed_dir))
        {
            let marker = public_path.destination(&paths.removed_dir);
            rootfs::ensure_safe_parent(&paths.removed_dir, &marker)?;
            public::remove_path(&marker)?;
            report
                .removed
                .push(format!("stale tombstone {}", public_path));
        }
    }
    Ok(())
}

#[cfg(unix)]
fn prune_stale_metadata(
    root: &Path,
    paths: &Paths,
    config: &Config,
    baseline: &BaselineDb,
    report: &mut PruneReport,
) -> Result<()> {
    let mut kept = Vec::new();
    let mut dropped = false;
    for record in metadata::load(&paths.metadata_file)? {
        let public_path = record.public_path()?;
        if public::is_excluded(&public_path, config) {
            kept.push(record);
            report.skipped.push(format!("excluded {}", public_path));
            continue;
        }
        let live_exists = exists_no_follow(&public::live_path(root, &public_path));
        let changed_exists = exists_no_follow(&public_path.destination(&paths.changed_dir));
        let baseline_exists = baseline.get(&public_path)?.is_some();
        if !live_exists && !changed_exists && !baseline_exists && !fallback_only_metadata(&record) {
            report
                .removed
                .push(format!("stale metadata {}", public_path));
            dropped = true;
        } else {
            kept.push(record);
        }
    }

    if dropped {
        metadata::replace(&paths.metadata_file, &kept)?;
    }
    Ok(())
}

#[cfg(unix)]
fn fallback_only_metadata(record: &metadata::MetadataRecord) -> bool {
    matches!(
        record.kind.as_str(),
        "fifo" | "char_device" | "block_device"
    )
}

#[cfg(unix)]
fn prune_empty_changed_dirs(
    root: &Path,
    paths: &Paths,
    config: &Config,
    baseline: &BaselineDb,
    report: &mut PruneReport,
) -> Result<()> {
    if !real_dir_exists(&paths.changed_dir)? {
        return Ok(());
    }
    let metadata_paths = metadata::load(&paths.metadata_file)?
        .into_iter()
        .map(|record| record.public_path().map(|path| path.as_bytes().to_vec()))
        .collect::<Result<BTreeSet<_>>>()?;
    let mut dirs = Vec::new();
    for entry in walkdir::WalkDir::new(&paths.changed_dir)
        .follow_links(false)
        .min_depth(1)
        .contents_first(true)
    {
        let entry = entry?;
        if entry.file_type().is_dir() {
            dirs.push(entry.path().to_path_buf());
        }
    }
    for dir in dirs {
        if fs::read_dir(&dir)?.next().is_some() {
            continue;
        }
        let public_path = dir
            .strip_prefix(&paths.changed_dir)
            .ok()
            .and_then(|path| public::PublicPath::from_root_relative(path).ok());
        let Some(public_path) = public_path else {
            continue;
        };
        if public::is_excluded(&public_path, config) {
            report.skipped.push(format!("excluded {}", public_path));
            continue;
        }
        if metadata_paths.contains(public_path.as_bytes()) {
            continue;
        }
        let live_exists = exists_no_follow(&public::live_path(root, &public_path));
        let baseline_exists = baseline.get(&public_path)?.is_some();
        if baseline_exists || !live_exists {
            fs::remove_dir(&dir)?;
            report
                .removed
                .push(format!("empty changed dir {}", public_path));
        }
    }
    Ok(())
}

#[cfg(unix)]
fn prune_empty_removed_dirs(
    paths: &Paths,
    config: &Config,
    report: &mut PruneReport,
) -> Result<()> {
    if !real_dir_exists(&paths.removed_dir)? {
        return Ok(());
    }
    let mut dirs = Vec::new();
    for entry in walkdir::WalkDir::new(&paths.removed_dir)
        .follow_links(false)
        .min_depth(1)
        .contents_first(true)
    {
        let entry = entry?;
        if entry.file_type().is_dir() {
            dirs.push(entry.path().to_path_buf());
        }
    }
    for dir in dirs {
        if fs::read_dir(&dir)?.next().is_some() {
            continue;
        }
        let public_path = dir
            .strip_prefix(&paths.removed_dir)
            .ok()
            .and_then(|path| public::PublicPath::from_root_relative(path).ok());
        let Some(public_path) = public_path else {
            continue;
        };
        if public::is_excluded(&public_path, config) {
            report.skipped.push(format!("excluded {}", public_path));
            continue;
        }
        fs::remove_dir(&dir)?;
        report
            .removed
            .push(format!("empty removed dir {}", public_path));
    }
    Ok(())
}

#[cfg(unix)]
fn exists_no_follow(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

#[cfg(unix)]
fn real_dir_exists(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(true),
        Ok(_) => anyhow::bail!("{} must be a real directory", path.display()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error).with_context(|| format!("stat {}", path.display())),
    }
}

pub fn print_human(report: &PruneReport) {
    println!("persistence prune:");
    if report.removed.is_empty() {
        println!("  removed: none");
    } else {
        for removed in &report.removed {
            println!("  removed: {removed}");
        }
    }
    for skipped in &report.skipped {
        println!("  skipped: {skipped}");
    }
}

#[cfg(test)]
mod tests {
    use super::run;
    use crate::{
        baseline::{BaselineDb, GenerateOptions, generate},
        config::Config,
        internal::StateDb,
        layout,
        metadata::{self, MetadataRecord},
        paths::Paths,
        public::PublicPath,
    };
    use std::{fs, os::unix::fs::symlink};

    #[test]
    fn prune_removes_stale_tombstone_and_empty_dirs() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.paths.removed_dir.join("gone")).unwrap();
        fs::write(fixture.paths.removed_dir.join("gone/file"), "").unwrap();

        let report = run(
            &fixture.root,
            &fixture.paths,
            &Config::default(),
            &fixture.baseline,
            &fixture.db,
        )
        .unwrap();

        assert!(
            report
                .removed
                .iter()
                .any(|item| item.contains("stale tombstone"))
        );
        assert!(!fixture.paths.removed_dir.join("gone/file").exists());
    }

    #[test]
    fn prune_removes_baseline_equal_changed_entry() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.paths.changed_dir.join("etc")).unwrap();
        fs::write(fixture.paths.changed_dir.join("etc/hello"), "hello").unwrap();

        let report = run(
            &fixture.root,
            &fixture.paths,
            &Config::default(),
            &fixture.baseline,
            &fixture.db,
        )
        .unwrap();

        assert!(
            report
                .removed
                .iter()
                .any(|item| item == "baseline-equal changed /etc/hello")
        );
        assert!(!fixture.paths.changed_dir.join("etc/hello").exists());
        assert!(!fixture.paths.changed_dir.join("etc").exists());
    }

    #[test]
    fn prune_removes_stale_normal_metadata_but_keeps_fallback_only_metadata() {
        let fixture = Fixture::new();
        upsert_metadata(&fixture.paths.metadata_file, "/orphan", "file");
        upsert_metadata(&fixture.paths.metadata_file, "/pipe", "fifo");

        let report = run(
            &fixture.root,
            &fixture.paths,
            &Config::default(),
            &fixture.baseline,
            &fixture.db,
        )
        .unwrap();

        assert!(
            report
                .removed
                .iter()
                .any(|item| item == "stale metadata /orphan")
        );
        assert!(
            !report
                .removed
                .iter()
                .any(|item| item == "stale metadata /pipe")
        );
        let records = metadata::load(&fixture.paths.metadata_file).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].public_path().unwrap().as_bytes(), b"/pipe");
        assert_eq!(records[0].kind, "fifo");
    }

    #[test]
    fn prune_leaves_excluded_dormant_public_truth_untouched() {
        let fixture = Fixture::new();
        let mut config = Config::default();
        config.exclusions.push("/secret".into());
        fs::create_dir_all(fixture.paths.changed_dir.join("secret")).unwrap();
        fs::write(fixture.paths.changed_dir.join("secret/file"), "user").unwrap();
        fs::create_dir_all(fixture.paths.removed_dir.join("secret")).unwrap();
        fs::write(fixture.paths.removed_dir.join("secret/deleted"), "").unwrap();
        upsert_metadata(&fixture.paths.metadata_file, "/secret/meta", "file");

        let report = run(
            &fixture.root,
            &fixture.paths,
            &config,
            &fixture.baseline,
            &fixture.db,
        )
        .unwrap();

        assert!(fixture.paths.changed_dir.join("secret/file").exists());
        assert!(fixture.paths.removed_dir.join("secret/deleted").exists());
        assert_eq!(
            metadata::load(&fixture.paths.metadata_file).unwrap().len(),
            1
        );
        assert!(
            report
                .skipped
                .iter()
                .any(|item| item == "excluded /secret/file")
        );
        assert!(
            report
                .skipped
                .iter()
                .any(|item| item == "excluded /secret/deleted")
        );
        assert!(
            report
                .skipped
                .iter()
                .any(|item| item == "excluded /secret/meta")
        );
    }

    #[test]
    fn prune_keeps_user_created_empty_changed_directory() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.root.join("empty-user-dir")).unwrap();
        fs::create_dir(fixture.paths.changed_dir.join("empty-user-dir")).unwrap();

        let report = run(
            &fixture.root,
            &fixture.paths,
            &Config::default(),
            &fixture.baseline,
            &fixture.db,
        )
        .unwrap();

        assert!(fixture.paths.changed_dir.join("empty-user-dir").is_dir());
        assert!(
            !report
                .removed
                .iter()
                .any(|item| item.contains("/empty-user-dir"))
        );
    }

    #[test]
    fn exists_no_follow_counts_broken_symlinks() {
        let temp = tempfile::tempdir().unwrap();
        let link = temp.path().join("broken");
        symlink("/missing-target", &link).unwrap();

        assert!(super::exists_no_follow(&link));
    }

    struct Fixture {
        _temp: tempfile::TempDir,
        root: std::path::PathBuf,
        paths: Paths,
        baseline: BaselineDb,
        db: StateDb,
    }

    impl Fixture {
        fn new() -> Self {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("root");
            let paths = Paths::new(
                root.join("opt/persistence"),
                temp.path().join("run/persistence"),
                temp.path().join("data/persistence"),
            );
            fs::create_dir_all(root.join("opt/persistence")).unwrap();
            fs::create_dir_all(root.join("etc")).unwrap();
            fs::write(root.join("etc/hello"), "hello").unwrap();
            generate(&GenerateOptions {
                root: root.clone(),
                output: paths.baseline_db.clone(),
            })
            .unwrap();
            layout::ensure(&paths).unwrap();
            let baseline = BaselineDb::open(&paths.baseline_db).unwrap();
            let db = StateDb::open_or_rebuild(&paths).unwrap();
            Self {
                _temp: temp,
                root,
                paths,
                baseline,
                db,
            }
        }
    }

    fn upsert_metadata(path: &std::path::Path, public_path: &str, kind: &str) {
        let public_path = PublicPath::parse(public_path).unwrap();
        let mut record = MetadataRecord {
            version: 1,
            path: String::new(),
            path_bytes_b64: None,
            kind: kind.into(),
            mode: None,
            uid: None,
            gid: None,
            mtime_ns: None,
            symlink_target: None,
            symlink_target_bytes_b64: None,
            rdev_major: None,
            rdev_minor: None,
            hardlink_key: None,
            xattrs: None,
            acl: None,
            capability: None,
        };
        record.set_public_path(&public_path);
        metadata::upsert(path, record).unwrap();
    }
}
