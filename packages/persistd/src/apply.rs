#![cfg(unix)]
#![allow(dead_code)]

use anyhow::{Context, Result, bail};
use filetime::{FileTime, set_file_times, set_symlink_file_times};
use std::{
    ffi::CString,
    fs::{self, File},
    io::{BufReader, BufWriter},
    os::unix::{
        ffi::OsStrExt,
        fs::{FileTypeExt, PermissionsExt, symlink},
    },
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

use crate::{
    config::Config,
    metadata::{self, MetadataRecord},
    paths::Paths,
};

pub fn apply_public_truth(root: &Path, paths: &Paths, config: &Config) -> Result<()> {
    apply_removed(root, paths, config)?;
    apply_changed(root, paths, config)?;
    apply_metadata(root, paths, config)?;
    Ok(())
}

fn apply_removed(root: &Path, paths: &Paths, config: &Config) -> Result<()> {
    let mut markers = public_entries(&paths.removed_dir)?;
    markers.sort_by_key(|path| std::cmp::Reverse(public_path_depth(path)));

    for public_path in markers {
        if is_excluded(&public_path, config) {
            continue;
        }
        remove_live_path(&live_path(root, &public_path)?)?;
    }
    Ok(())
}

fn apply_changed(root: &Path, paths: &Paths, config: &Config) -> Result<()> {
    let mut entries = changed_entries(&paths.changed_dir)?;
    entries.sort_by_key(|entry| public_path_depth(&entry.0));

    for (public_path, changed_path) in entries {
        if is_excluded(&public_path, config) {
            continue;
        }
        apply_changed_entry(root, &public_path, &changed_path)?;
    }
    Ok(())
}

fn apply_metadata(root: &Path, paths: &Paths, config: &Config) -> Result<()> {
    let records = metadata::compact(&paths.metadata_file)?;
    for record in records {
        if is_excluded(&record.path, config) {
            continue;
        }
        let target = live_path(root, &record.path)?;
        if !target.exists() && fs::symlink_metadata(&target).is_err() {
            continue;
        }
        apply_metadata_record(&target, &record)?;
    }
    Ok(())
}

fn apply_changed_entry(root: &Path, public_path: &str, changed_path: &Path) -> Result<()> {
    let target = live_path(root, public_path)?;
    let metadata = fs::symlink_metadata(changed_path)
        .with_context(|| format!("stat changed {}", changed_path.display()))?;
    let file_type = metadata.file_type();

    ensure_safe_parent(root, &target)?;
    remove_live_path(&target)?;

    if file_type.is_dir() {
        fs::create_dir_all(&target).with_context(|| format!("create {}", target.display()))?;
    } else if file_type.is_file() {
        copy_file_atomic(changed_path, &target)?;
    } else if file_type.is_symlink() {
        let link_target = fs::read_link(changed_path)
            .with_context(|| format!("readlink {}", changed_path.display()))?;
        symlink_atomic(&link_target, &target)?;
    } else {
        bail!(
            "apply changed does not yet support {} at {}",
            kind(&file_type),
            changed_path.display()
        );
    }
    Ok(())
}

fn apply_metadata_record(target: &Path, record: &MetadataRecord) -> Result<()> {
    let metadata = fs::symlink_metadata(target)
        .with_context(|| format!("stat metadata target {}", target.display()))?;
    let is_symlink = metadata.file_type().is_symlink();

    if let (Some(uid), Some(gid)) = (record.uid, record.gid) {
        lchown(target, uid, gid)?;
    }

    if let Some(mode) = record.mode
        && !is_symlink
    {
        fs::set_permissions(target, fs::Permissions::from_mode(mode))
            .with_context(|| format!("chmod {}", target.display()))?;
    }

    if let Some(mtime_ns) = record.mtime_ns {
        let mtime = file_time_from_ns(mtime_ns);
        if is_symlink {
            set_symlink_file_times(target, mtime, mtime)
                .with_context(|| format!("set symlink time {}", target.display()))?;
        } else {
            set_file_times(target, mtime, mtime)
                .with_context(|| format!("set file time {}", target.display()))?;
        }
    }

    Ok(())
}

fn public_entries(root: &Path) -> Result<Vec<String>> {
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for entry in WalkDir::new(root).follow_links(false).min_depth(1) {
        let entry = entry?;
        let relative = entry.path().strip_prefix(root)?;
        entries.push(format_public_path(relative));
    }
    Ok(entries)
}

fn changed_entries(root: &Path) -> Result<Vec<(String, PathBuf)>> {
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for entry in WalkDir::new(root).follow_links(false).min_depth(1) {
        let entry = entry?;
        if entry.file_type().is_dir() && !is_empty_dir(entry.path())? {
            continue;
        }
        let relative = entry.path().strip_prefix(root)?;
        entries.push((format_public_path(relative), entry.path().to_path_buf()));
    }
    Ok(entries)
}

fn is_empty_dir(path: &Path) -> Result<bool> {
    Ok(fs::read_dir(path)
        .with_context(|| format!("read {}", path.display()))?
        .next()
        .is_none())
}

fn format_public_path(path: &Path) -> String {
    let text = path.to_string_lossy().replace('\\', "/");
    format!("/{text}")
}

fn public_path_depth(path: &str) -> usize {
    path.split('/').filter(|part| !part.is_empty()).count()
}

fn live_path(root: &Path, public_path: &str) -> Result<PathBuf> {
    if !public_path.starts_with('/') || public_path == "/" {
        bail!("invalid public path: {public_path}");
    }
    if public_path.split('/').any(|part| part == "..") {
        bail!("public path cannot contain '..': {public_path}");
    }
    Ok(root.join(public_path.trim_start_matches('/')))
}

fn is_excluded(path: &str, config: &Config) -> bool {
    config.exclusions.iter().any(|excluded| {
        path == excluded
            || path
                .strip_prefix(excluded)
                .is_some_and(|rest| rest.starts_with('/'))
    })
}

fn ensure_safe_parent(root: &Path, target: &Path) -> Result<()> {
    let parent = target
        .parent()
        .with_context(|| format!("target has no parent: {}", target.display()))?;
    let relative = parent
        .strip_prefix(root)
        .with_context(|| format!("target escaped root: {}", target.display()))?;

    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                bail!(
                    "refusing to apply through symlink ancestor {}",
                    current.display()
                );
            }
            Ok(metadata) if !metadata.file_type().is_dir() => {
                bail!("ancestor is not a directory: {}", current.display());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                fs::create_dir(&current)
                    .with_context(|| format!("create {}", current.display()))?;
            }
            Err(error) => return Err(error).with_context(|| format!("stat {}", current.display())),
        }
    }
    Ok(())
}

fn remove_live_path(path: &Path) -> Result<()> {
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

fn copy_file_atomic(source: &Path, target: &Path) -> Result<()> {
    let temp = temp_path(target);
    {
        let mut reader = BufReader::new(File::open(source)?);
        let mut writer = BufWriter::new(File::create(&temp)?);
        std::io::copy(&mut reader, &mut writer)
            .with_context(|| format!("copy {} to {}", source.display(), temp.display()))?;
    }
    fs::rename(&temp, target)
        .with_context(|| format!("publish {} to {}", temp.display(), target.display()))
}

fn symlink_atomic(source: &Path, target: &Path) -> Result<()> {
    let temp = temp_path(target);
    let _ = fs::remove_file(&temp);
    symlink(source, &temp).with_context(|| format!("symlink {}", temp.display()))?;
    fs::rename(&temp, target)
        .with_context(|| format!("publish {} to {}", temp.display(), target.display()))
}

fn temp_path(target: &Path) -> PathBuf {
    target.with_file_name(format!(
        ".{}.persistd-tmp",
        target
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("target")
    ))
}

fn lchown(path: &Path, uid: u32, gid: u32) -> Result<()> {
    let c_path = CString::new(path.as_os_str().as_bytes())
        .with_context(|| format!("path contains NUL: {}", path.display()))?;
    let result = unsafe { libc::lchown(c_path.as_ptr(), uid, gid) };
    if result == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error()).with_context(|| format!("lchown {}", path.display()))
    }
}

fn file_time_from_ns(ns: i64) -> FileTime {
    let seconds = ns.div_euclid(1_000_000_000);
    let nanos = ns.rem_euclid(1_000_000_000) as u32;
    FileTime::from_unix_time(seconds, nanos)
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

#[cfg(test)]
mod tests {
    use super::apply_public_truth;
    use crate::{
        config::Config,
        layout,
        metadata::{self, MetadataRecord},
        paths::Paths,
    };
    use std::{fs, os::unix::fs::symlink};

    #[test]
    fn apply_removes_then_restores_changed_file_so_changed_wins() {
        let fixture = Fixture::new();
        fs::write(fixture.root.join("etc/conf"), "image").unwrap();
        fs::create_dir_all(fixture.paths.removed_dir.join("etc")).unwrap();
        fs::write(fixture.paths.removed_dir.join("etc/conf"), "").unwrap();
        fs::create_dir_all(fixture.paths.changed_dir.join("etc")).unwrap();
        fs::write(fixture.paths.changed_dir.join("etc/conf"), "changed").unwrap();

        apply_public_truth(&fixture.root, &fixture.paths, &Config::default()).unwrap();

        assert_eq!(
            fs::read_to_string(fixture.root.join("etc/conf")).unwrap(),
            "changed"
        );
    }

    #[test]
    fn apply_removes_deleted_image_path() {
        let fixture = Fixture::new();
        fs::write(fixture.root.join("remove-me"), "image").unwrap();
        fs::write(fixture.paths.removed_dir.join("remove-me"), "").unwrap();

        apply_public_truth(&fixture.root, &fixture.paths, &Config::default()).unwrap();

        assert!(!fixture.root.join("remove-me").exists());
    }

    #[test]
    fn apply_restores_changed_directory_file_and_symlink() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.paths.changed_dir.join("dir")).unwrap();
        fs::write(fixture.paths.changed_dir.join("dir/file"), "file").unwrap();
        symlink("/dir/file", fixture.paths.changed_dir.join("link")).unwrap();

        apply_public_truth(&fixture.root, &fixture.paths, &Config::default()).unwrap();

        assert_eq!(
            fs::read_to_string(fixture.root.join("dir/file")).unwrap(),
            "file"
        );
        assert_eq!(
            fs::read_link(fixture.root.join("link")).unwrap(),
            std::path::PathBuf::from("/dir/file")
        );
    }

    #[test]
    fn apply_metadata_sets_mode_and_mtime() {
        let fixture = Fixture::new();
        fs::write(fixture.root.join("file"), "file").unwrap();
        metadata::upsert(
            &fixture.paths.metadata_file,
            MetadataRecord {
                path: "/file".into(),
                kind: "file".into(),
                mode: Some(0o600),
                uid: None,
                gid: None,
                mtime_ns: Some(42_000_000_123),
                symlink_target: None,
                xattrs: None,
                acl: None,
                capability: None,
            },
        )
        .unwrap();

        apply_public_truth(&fixture.root, &fixture.paths, &Config::default()).unwrap();

        let metadata = fs::metadata(fixture.root.join("file")).unwrap();
        assert_eq!(
            std::os::unix::fs::PermissionsExt::mode(&metadata.permissions()) & 0o777,
            0o600
        );
        assert_eq!(std::os::unix::fs::MetadataExt::mtime(&metadata), 42);
        assert_eq!(std::os::unix::fs::MetadataExt::mtime_nsec(&metadata), 123);
    }

    #[test]
    fn apply_refuses_symlink_ancestor_escape() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.paths.changed_dir.join("safe/link")).unwrap();
        fs::write(fixture.paths.changed_dir.join("safe/link/file"), "nope").unwrap();
        fs::create_dir_all(fixture.root.join("safe")).unwrap();
        symlink("/tmp", fixture.root.join("safe/link")).unwrap();

        let error = apply_public_truth(&fixture.root, &fixture.paths, &Config::default())
            .unwrap_err()
            .to_string();

        assert!(error.contains("symlink ancestor"));
    }

    struct Fixture {
        _temp: tempfile::TempDir,
        root: std::path::PathBuf,
        paths: Paths,
    }

    impl Fixture {
        fn new() -> Self {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("root");
            let paths = Paths::new(
                root.join("opt/persistd"),
                temp.path().join("run/persistd"),
                temp.path().join("data/persistd"),
            );
            fs::create_dir_all(root.join("etc")).unwrap();
            layout::ensure(&paths).unwrap();
            Self {
                _temp: temp,
                root,
                paths,
            }
        }
    }
}
