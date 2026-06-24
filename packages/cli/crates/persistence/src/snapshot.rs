use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[cfg(unix)]
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(unix)]
use crate::{metadata, paths::Paths, public};

/// A consistent point-in-time copy of persisted public truth, materialized on
/// the volume for an external uploader to read. `path` is the frozen directory;
/// the caller owns removing it when done.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotReport {
    pub id: String,
    pub path: String,
    pub created_at: String,
    pub changed: u64,
    pub removed: u64,
    pub metadata: u64,
}

#[cfg(unix)]
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u8,
    id: String,
    created_at: String,
    changed: u64,
    removed: u64,
    metadata: u64,
}

/// Build a frozen, internally-consistent copy of `config.json`, `changed/`,
/// `removed/`, and `metadata.jsonl` under `.internal/snapshots/<id>`.
///
/// Runs on the daemon's single writer thread (via the control socket), so no
/// delta update is in flight while it runs - the four pieces are mutually
/// consistent. `changed/` and `removed/` are published by atomic rename, so a
/// hardlink pins a true point-in-time even after the writer resumes writing.
/// `state.sqlite` is intentionally omitted: it is derived and rebuilt on open.
#[cfg(unix)]
pub fn run(paths: &Paths) -> Result<SnapshotReport> {
    fs::create_dir_all(&paths.snapshots_dir)
        .with_context(|| format!("create {}", paths.snapshots_dir.display()))?;

    let id = snapshot_id();
    let staging = paths.snapshots_dir.join(format!("{id}.partial"));
    let final_dir = paths.snapshots_dir.join(&id);
    // A pre-existing dir with this id can only be crash debris: the writer is
    // the sole creator and ids are time-ordered.
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_dir_all(&final_dir);
    fs::create_dir_all(&staging).with_context(|| format!("create {}", staging.display()))?;

    copy_real_file(&paths.config_file, &staging.join("config.json"))?;
    copy_real_file(&paths.metadata_file, &staging.join("metadata.jsonl"))?;

    // ponytail: O(entries) link syscalls on the writer thread, no per-file
    // fsync (the snapshot dir is ephemeral, consumed by the uploader). Fine for
    // any real delta; if a box ever holds millions of changed files, move to a
    // two-phase generation-marker snapshot so the writer pause stays bounded.
    let changed = hardlink_tree(&paths.changed_dir, &staging.join("changed"))?;
    let removed = hardlink_tree(&paths.removed_dir, &staging.join("removed"))?;
    let metadata = metadata::load(&paths.metadata_file)?.len() as u64;

    let manifest = Manifest {
        version: 1,
        id: id.clone(),
        created_at: id.clone(),
        changed,
        removed,
        metadata,
    };
    write_manifest(&staging.join("manifest.json"), &manifest)?;

    fs::rename(&staging, &final_dir).with_context(|| {
        format!(
            "publish snapshot {} to {}",
            staging.display(),
            final_dir.display()
        )
    })?;

    Ok(SnapshotReport {
        id: id.clone(),
        path: final_dir.to_string_lossy().into_owned(),
        created_at: id,
        changed,
        removed,
        metadata,
    })
}

#[cfg(not(unix))]
pub fn run(_paths: &crate::paths::Paths) -> Result<SnapshotReport> {
    anyhow::bail!("persistence snapshot is only supported on Unix")
}

#[cfg(unix)]
fn snapshot_id() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}-{:09}", now.as_secs(), now.subsec_nanos())
}

#[cfg(unix)]
fn copy_real_file(source: &Path, destination: &Path) -> Result<()> {
    match fs::symlink_metadata(source) {
        Ok(metadata) if metadata.file_type().is_file() => {
            fs::copy(source, destination).with_context(|| {
                format!("copy {} to {}", source.display(), destination.display())
            })?;
            Ok(())
        }
        Ok(_) => anyhow::bail!("{} must be a real file", source.display()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("stat {}", source.display())),
    }
}

#[cfg(unix)]
fn hardlink_tree(source: &Path, destination: &Path) -> Result<u64> {
    fs::create_dir_all(destination).with_context(|| format!("create {}", destination.display()))?;
    let mut files = 0;
    for entry in public::list_public_entries(source)? {
        let target = entry.path.destination(destination);
        let kind = fs::symlink_metadata(&entry.full_path)
            .with_context(|| format!("stat {}", entry.full_path.display()))?;
        if kind.file_type().is_dir() {
            fs::create_dir_all(&target).with_context(|| format!("create {}", target.display()))?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)
                    .with_context(|| format!("create {}", parent.display()))?;
            }
            fs::hard_link(&entry.full_path, &target).with_context(|| {
                format!(
                    "hardlink {} to {}",
                    entry.full_path.display(),
                    target.display()
                )
            })?;
            files += 1;
        }
    }
    Ok(files)
}

#[cfg(unix)]
fn write_manifest(path: &Path, manifest: &Manifest) -> Result<()> {
    let mut data = serde_json::to_vec_pretty(manifest).context("encode snapshot manifest")?;
    data.push(b'\n');
    fs::write(path, data).with_context(|| format!("write {}", path.display()))
}

pub fn print_human(report: &SnapshotReport) {
    println!("persistence snapshot:");
    println!("  id: {}", report.id);
    println!("  path: {}", report.path);
    println!("  changed: {}", report.changed);
    println!("  removed: {}", report.removed);
    println!("  metadata: {}", report.metadata);
}

#[cfg(all(test, unix))]
mod tests {
    use super::run;
    use crate::{layout, paths::Paths};
    use std::fs;

    #[test]
    fn snapshot_captures_public_truth_into_frozen_dir() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.paths.changed_dir.join("etc")).unwrap();
        fs::write(fixture.paths.changed_dir.join("etc/hosts"), "changed").unwrap();
        fs::create_dir_all(fixture.paths.removed_dir.join("etc")).unwrap();
        fs::write(fixture.paths.removed_dir.join("etc/gone"), "").unwrap();
        fs::write(
            &fixture.paths.metadata_file,
            "{\"path\":\"/etc/hosts\",\"kind\":\"file\"}\n",
        )
        .unwrap();

        let report = run(&fixture.paths).unwrap();
        let dir = std::path::PathBuf::from(&report.path);

        assert_eq!(report.changed, 1);
        assert_eq!(report.removed, 1);
        assert_eq!(report.metadata, 1);
        assert_eq!(
            fs::read_to_string(dir.join("changed/etc/hosts")).unwrap(),
            "changed"
        );
        assert!(dir.join("removed/etc/gone").exists());
        assert!(dir.join("metadata.jsonl").exists());
        assert!(dir.join("config.json").exists());
        assert!(dir.join("manifest.json").exists());
    }

    #[test]
    fn snapshot_pins_point_in_time_against_later_writes() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.paths.changed_dir.join("etc")).unwrap();
        let live = fixture.paths.changed_dir.join("etc/hosts");
        fs::write(&live, "original").unwrap();

        let report = run(&fixture.paths).unwrap();
        let snapped = std::path::PathBuf::from(&report.path).join("changed/etc/hosts");

        // The writer publishes changed files by atomic rename (new inode), so a
        // later overwrite must not be visible through the hardlinked snapshot.
        fs::remove_file(&live).unwrap();
        fs::write(&live, "replaced").unwrap();

        assert_eq!(fs::read_to_string(&snapped).unwrap(), "original");
        assert_eq!(fs::read_to_string(&live).unwrap(), "replaced");
    }

    struct Fixture {
        _temp: tempfile::TempDir,
        paths: Paths,
    }

    impl Fixture {
        fn new() -> Self {
            let temp = tempfile::tempdir().unwrap();
            let paths = Paths::new(
                temp.path().join("opt/persistence"),
                temp.path().join("run/persistence"),
                temp.path().join("data/persistence"),
            );
            layout::ensure(&paths).unwrap();
            Self { _temp: temp, paths }
        }
    }
}
