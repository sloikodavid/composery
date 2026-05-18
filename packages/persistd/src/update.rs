#![cfg(unix)]
#![allow(dead_code)]

use anyhow::{Context, Result, bail};
use std::{
    fs::{self, File},
    io::{BufReader, BufWriter},
    os::unix::fs::{FileTypeExt, MetadataExt, symlink},
    path::{Path, PathBuf},
};

use crate::{baseline::BaselineDb, config::Config, metadata, paths::Paths};

pub struct UpdateContext<'a> {
    pub root: &'a Path,
    pub paths: &'a Paths,
    pub config: &'a Config,
    pub baseline: &'a BaselineDb,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UpdateOutcome {
    Ignored,
    Pruned,
    PersistedChanged,
    PersistedRemoved,
}

pub fn update_path(ctx: &UpdateContext<'_>, path: &str) -> Result<UpdateOutcome> {
    let path = normalize_path(path)?;
    if is_excluded(&path, ctx.config) {
        return Ok(UpdateOutcome::Ignored);
    }

    let live_path = live_path(ctx.root, &path);
    let baseline = ctx.baseline.get(&path)?;
    let live = match fs::symlink_metadata(&live_path) {
        Ok(metadata) => Some(metadata),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(error).with_context(|| format!("stat {}", live_path.display())),
    };

    match (live, baseline) {
        (None, Some(_)) => {
            remove_changed(ctx.paths, &path)?;
            write_removed_marker(ctx.paths, &path)?;
            metadata::remove(&ctx.paths.metadata_file, &path)?;
            Ok(UpdateOutcome::PersistedRemoved)
        }
        (None, None) => {
            remove_changed(ctx.paths, &path)?;
            remove_removed_marker(ctx.paths, &path)?;
            metadata::remove(&ctx.paths.metadata_file, &path)?;
            Ok(UpdateOutcome::Pruned)
        }
        (Some(metadata), Some(record)) => {
            if equals_baseline(&live_path, &metadata, &record)? {
                remove_changed(ctx.paths, &path)?;
                remove_removed_marker(ctx.paths, &path)?;
                metadata::remove(&ctx.paths.metadata_file, &path)?;
                Ok(UpdateOutcome::Pruned)
            } else {
                persist_changed(ctx.paths, &path, &live_path, &metadata)?;
                remove_removed_marker(ctx.paths, &path)?;
                Ok(UpdateOutcome::PersistedChanged)
            }
        }
        (Some(metadata), None) => {
            persist_changed(ctx.paths, &path, &live_path, &metadata)?;
            remove_removed_marker(ctx.paths, &path)?;
            Ok(UpdateOutcome::PersistedChanged)
        }
    }
}

fn normalize_path(path: &str) -> Result<String> {
    if !path.starts_with('/') {
        bail!("path must be absolute: {path}");
    }
    if path == "/" {
        bail!("root path cannot be updated");
    }
    if path.split('/').any(|part| part == "..") {
        bail!("path cannot contain '..': {path}");
    }

    let mut normalized = String::new();
    for part in path
        .split('/')
        .filter(|part| !part.is_empty() && *part != ".")
    {
        normalized.push('/');
        normalized.push_str(part);
    }

    if normalized.is_empty() {
        bail!("root path cannot be updated");
    }
    Ok(normalized)
}

fn is_excluded(path: &str, config: &Config) -> bool {
    config.exclusions.iter().any(|excluded| {
        path == excluded
            || path
                .strip_prefix(excluded)
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

fn live_path(root: &Path, path: &str) -> PathBuf {
    root.join(path.trim_start_matches('/'))
}

fn equals_baseline(
    live_path: &Path,
    metadata: &fs::Metadata,
    record: &crate::baseline::BaselineRecord,
) -> Result<bool> {
    let file_type = metadata.file_type();
    if kind(&file_type) != record.kind {
        return Ok(false);
    }

    if i64::from(metadata.mode()) != record.mode {
        return Ok(false);
    }
    if i64::from(metadata.uid()) != record.uid || i64::from(metadata.gid()) != record.gid {
        return Ok(false);
    }

    if file_type.is_file() {
        let size: i64 = metadata.len().try_into().context("file size overflow")?;
        if Some(size) != record.size {
            return Ok(false);
        }
        return Ok(Some(hash_file(live_path)?) == record.content_hash);
    }

    if file_type.is_symlink() {
        let target = fs::read_link(live_path)
            .with_context(|| format!("readlink {}", live_path.display()))?
            .to_string_lossy()
            .into_owned();
        return Ok(Some(target) == record.symlink_target);
    }

    if file_type.is_char_device() || file_type.is_block_device() {
        let (major, minor) = device_numbers(metadata, &file_type);
        return Ok(major == record.rdev_major && minor == record.rdev_minor);
    }

    Ok(true)
}

fn persist_changed(
    paths: &Paths,
    public_path: &str,
    live_path: &Path,
    metadata: &fs::Metadata,
) -> Result<()> {
    let destination = public_path_destination(&paths.changed_dir, public_path);
    remove_removed_marker(paths, public_path)?;
    remove_path(&destination)?;
    ensure_parent(&destination)?;

    let file_type = metadata.file_type();
    if file_type.is_file() {
        copy_file_atomic(live_path, &destination)?;
    } else if file_type.is_dir() {
        fs::create_dir_all(&destination)
            .with_context(|| format!("create changed dir {}", destination.display()))?;
    } else if file_type.is_symlink() {
        let target = fs::read_link(live_path)
            .with_context(|| format!("readlink {}", live_path.display()))?;
        symlink_atomic(&target, &destination)?;
    } else {
        bail!(
            "persist changed does not yet support {} at {}",
            kind(&file_type),
            live_path.display()
        );
    }

    metadata::upsert(
        &paths.metadata_file,
        metadata_record(public_path, live_path, metadata)?,
    )?;

    Ok(())
}

fn remove_changed(paths: &Paths, public_path: &str) -> Result<()> {
    remove_path(&public_path_destination(&paths.changed_dir, public_path))
}

fn write_removed_marker(paths: &Paths, public_path: &str) -> Result<()> {
    let marker = public_path_destination(&paths.removed_dir, public_path);
    ensure_parent(&marker)?;
    let temp = temp_path(&marker);
    fs::write(&temp, []).with_context(|| format!("write removed marker {}", temp.display()))?;
    fs::rename(&temp, &marker)
        .with_context(|| format!("publish removed marker {}", marker.display()))
}

fn remove_removed_marker(paths: &Paths, public_path: &str) -> Result<()> {
    remove_path(&public_path_destination(&paths.removed_dir, public_path))
}

fn public_path_destination(root: &Path, public_path: &str) -> PathBuf {
    root.join(public_path.trim_start_matches('/'))
}

fn ensure_parent(path: &Path) -> Result<()> {
    let parent = path
        .parent()
        .with_context(|| format!("path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))
}

fn remove_path(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => {
            fs::remove_dir_all(path).with_context(|| format!("remove dir {}", path.display()))?;
        }
        Ok(_) => {
            fs::remove_file(path).with_context(|| format!("remove file {}", path.display()))?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error).with_context(|| format!("stat {}", path.display())),
    }
    Ok(())
}

fn hash_file(path: &Path) -> Result<String> {
    let file = File::open(path).with_context(|| format!("open {}", path.display()))?;
    let mut reader = BufReader::new(file);
    let mut hasher = blake3::Hasher::new();
    hasher
        .update_reader(&mut reader)
        .with_context(|| format!("hash {}", path.display()))?;
    Ok(hasher.finalize().to_hex().to_string())
}

fn copy_file_atomic(source: &Path, destination: &Path) -> Result<()> {
    let temp = temp_path(destination);
    {
        let mut reader = BufReader::new(File::open(source)?);
        let mut writer = BufWriter::new(File::create(&temp)?);
        std::io::copy(&mut reader, &mut writer)
            .with_context(|| format!("copy {} to {}", source.display(), temp.display()))?;
    }
    fs::rename(&temp, destination)
        .with_context(|| format!("publish {} to {}", temp.display(), destination.display()))
}

fn symlink_atomic(target: &Path, destination: &Path) -> Result<()> {
    let temp = temp_path(destination);
    let _ = fs::remove_file(&temp);
    symlink(target, &temp).with_context(|| format!("symlink {}", temp.display()))?;
    fs::rename(&temp, destination)
        .with_context(|| format!("publish {} to {}", temp.display(), destination.display()))
}

fn temp_path(path: &Path) -> PathBuf {
    path.with_file_name(format!(
        ".{}.persistd-tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("target")
    ))
}

fn metadata_record(
    public_path: &str,
    live_path: &Path,
    metadata: &fs::Metadata,
) -> Result<metadata::MetadataRecord> {
    let file_type = metadata.file_type();
    Ok(metadata::MetadataRecord {
        path: public_path.to_string(),
        kind: kind(&file_type).to_string(),
        mode: Some(metadata.mode()),
        uid: Some(metadata.uid()),
        gid: Some(metadata.gid()),
        mtime_ns: Some(metadata.mtime() * 1_000_000_000 + metadata.mtime_nsec()),
        symlink_target: if file_type.is_symlink() {
            Some(
                fs::read_link(live_path)
                    .with_context(|| format!("readlink {}", live_path.display()))?
                    .to_string_lossy()
                    .into_owned(),
            )
        } else {
            None
        },
        xattrs: None,
        acl: None,
        capability: None,
    })
}

fn kind(file_type: &std::fs::FileType) -> &'static str {
    if file_type.is_file() {
        "file"
    } else if file_type.is_dir() {
        "dir"
    } else if file_type.is_symlink() {
        "symlink"
    } else if file_type.is_fifo() {
        "fifo"
    } else if file_type.is_socket() {
        "socket"
    } else if file_type.is_char_device() {
        "char_device"
    } else if file_type.is_block_device() {
        "block_device"
    } else {
        "unknown"
    }
}

fn device_numbers(
    metadata: &fs::Metadata,
    file_type: &std::fs::FileType,
) -> (Option<i64>, Option<i64>) {
    if !(file_type.is_char_device() || file_type.is_block_device()) {
        return (None, None);
    }

    let rdev = metadata.rdev();
    let major = ((rdev >> 8) & 0xfff) | ((rdev >> 32) & !0xfff);
    let minor = (rdev & 0xff) | ((rdev >> 12) & !0xff);
    (Some(major as i64), Some(minor as i64))
}

#[cfg(test)]
mod tests {
    use super::{UpdateContext, UpdateOutcome, update_path};
    use crate::{
        baseline::{BaselineDb, GenerateOptions, generate},
        config::Config,
        layout,
        paths::Paths,
    };
    use std::{fs, os::unix::fs::symlink};

    #[test]
    fn changed_file_is_captured_and_removed_marker_is_cleared() {
        let fixture = Fixture::new();
        fs::write(fixture.root.join("etc/hello.txt"), "changed").unwrap();
        fs::create_dir_all(fixture.paths.removed_dir.join("etc")).unwrap();
        fs::write(fixture.paths.removed_dir.join("etc/hello.txt"), "").unwrap();

        let outcome = update_path(&fixture.ctx(), "/etc/hello.txt").unwrap();

        assert_eq!(outcome, UpdateOutcome::PersistedChanged);
        assert_eq!(
            fs::read_to_string(fixture.paths.changed_dir.join("etc/hello.txt")).unwrap(),
            "changed"
        );
        assert!(!fixture.paths.removed_dir.join("etc/hello.txt").exists());
        let metadata = crate::metadata::load(&fixture.paths.metadata_file).unwrap();
        assert_eq!(metadata.len(), 1);
        assert_eq!(metadata[0].path, "/etc/hello.txt");
    }

    #[test]
    fn baseline_equal_file_prunes_changed_and_removed_entries() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.paths.changed_dir.join("etc")).unwrap();
        fs::write(fixture.paths.changed_dir.join("etc/hello.txt"), "stale").unwrap();
        fs::create_dir_all(fixture.paths.removed_dir.join("etc")).unwrap();
        fs::write(fixture.paths.removed_dir.join("etc/hello.txt"), "").unwrap();

        let outcome = update_path(&fixture.ctx(), "/etc/hello.txt").unwrap();

        assert_eq!(outcome, UpdateOutcome::Pruned);
        assert!(!fixture.paths.changed_dir.join("etc/hello.txt").exists());
        assert!(!fixture.paths.removed_dir.join("etc/hello.txt").exists());
        assert!(
            crate::metadata::load(&fixture.paths.metadata_file)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn touched_but_equal_file_does_not_persist() {
        let fixture = Fixture::new();
        let file = fixture.root.join("etc/hello.txt");
        let mut times =
            filetime::FileTime::from_last_modification_time(&fs::metadata(&file).unwrap());
        times = filetime::FileTime::from_unix_time(times.unix_seconds() + 10, 0);
        filetime::set_file_mtime(&file, times).unwrap();

        let outcome = update_path(&fixture.ctx(), "/etc/hello.txt").unwrap();

        assert_eq!(outcome, UpdateOutcome::Pruned);
        assert!(!fixture.paths.changed_dir.join("etc/hello.txt").exists());
    }

    #[test]
    fn missing_baseline_file_creates_removed_marker() {
        let fixture = Fixture::new();
        fs::remove_file(fixture.root.join("etc/hello.txt")).unwrap();

        let outcome = update_path(&fixture.ctx(), "/etc/hello.txt").unwrap();

        assert_eq!(outcome, UpdateOutcome::PersistedRemoved);
        assert!(fixture.paths.removed_dir.join("etc/hello.txt").exists());
        assert!(!fixture.paths.changed_dir.join("etc/hello.txt").exists());
        assert!(
            crate::metadata::load(&fixture.paths.metadata_file)
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn missing_new_file_prunes_without_tombstone() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.paths.changed_dir.join("workspace")).unwrap();
        fs::write(fixture.paths.changed_dir.join("workspace/new.txt"), "stale").unwrap();

        let outcome = update_path(&fixture.ctx(), "/workspace/new.txt").unwrap();

        assert_eq!(outcome, UpdateOutcome::Pruned);
        assert!(!fixture.paths.changed_dir.join("workspace/new.txt").exists());
        assert!(!fixture.paths.removed_dir.join("workspace/new.txt").exists());
    }

    #[test]
    fn new_file_is_captured() {
        let fixture = Fixture::new();
        fs::write(fixture.root.join("new.txt"), "new").unwrap();

        let outcome = update_path(&fixture.ctx(), "/new.txt").unwrap();

        assert_eq!(outcome, UpdateOutcome::PersistedChanged);
        assert_eq!(
            fs::read_to_string(fixture.paths.changed_dir.join("new.txt")).unwrap(),
            "new"
        );
    }

    #[test]
    fn changed_symlink_is_captured() {
        let fixture = Fixture::new();
        fs::remove_file(fixture.root.join("etc/hello-link")).unwrap();
        symlink("/new-target", fixture.root.join("etc/hello-link")).unwrap();

        let outcome = update_path(&fixture.ctx(), "/etc/hello-link").unwrap();

        assert_eq!(outcome, UpdateOutcome::PersistedChanged);
        assert_eq!(
            fs::read_link(fixture.paths.changed_dir.join("etc/hello-link")).unwrap(),
            std::path::PathBuf::from("/new-target")
        );
    }

    #[test]
    fn excluded_path_is_ignored() {
        let fixture = Fixture::new();

        let outcome = update_path(&fixture.ctx(), "/data/ignored").unwrap();

        assert_eq!(outcome, UpdateOutcome::Ignored);
    }

    struct Fixture {
        _temp: tempfile::TempDir,
        root: std::path::PathBuf,
        paths: Paths,
        baseline: BaselineDb,
        config: Config,
    }

    impl Fixture {
        fn new() -> Self {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("root");
            let data = temp.path().join("data/persistd");
            let run = temp.path().join("run/persistd");
            let opt = root.join("opt/persistd");
            let baseline = opt.join("baseline.sqlite");

            fs::create_dir_all(root.join("etc")).unwrap();
            fs::create_dir_all(&opt).unwrap();
            fs::write(root.join("etc/hello.txt"), "hello").unwrap();
            symlink("/etc/hello.txt", root.join("etc/hello-link")).unwrap();

            generate(&GenerateOptions {
                root: root.clone(),
                output: baseline.clone(),
            })
            .unwrap();

            let paths = Paths::new(opt, run, data);
            layout::ensure(&paths).unwrap();
            let baseline = BaselineDb::open(&baseline).unwrap();

            Self {
                _temp: temp,
                root,
                paths,
                baseline,
                config: Config::default(),
            }
        }

        fn ctx(&self) -> UpdateContext<'_> {
            UpdateContext {
                root: &self.root,
                paths: &self.paths,
                config: &self.config,
                baseline: &self.baseline,
            }
        }
    }
}
