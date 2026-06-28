#![allow(dead_code)]

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
};

#[cfg(unix)]
use crate::{public::PublicPath, rootfs::XattrRecord};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataRecord {
    #[serde(default = "metadata_schema_version")]
    pub version: u8,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path_bytes_b64: Option<String>,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mtime_ns: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symlink_target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub symlink_target_bytes_b64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rdev_major: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rdev_minor: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hardlink_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xattrs: Option<Vec<XattrRecord>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acl: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability: Option<Value>,
}

fn metadata_schema_version() -> u8 {
    1
}

impl MetadataRecord {
    #[cfg(unix)]
    pub fn public_path(&self) -> Result<PublicPath> {
        if let Some(path_bytes_b64) = &self.path_bytes_b64 {
            return PublicPath::from_encoded(&crate::public::EncodedPath {
                display: self.path.clone(),
                bytes_b64: path_bytes_b64.clone(),
            });
        }
        PublicPath::from_legacy_display(&self.path)
    }

    #[cfg(unix)]
    pub fn set_public_path(&mut self, public_path: &PublicPath) {
        self.path = public_path.display();
        self.path_bytes_b64 = Some(public_path.bytes_b64());
    }

    #[cfg(unix)]
    fn key(&self) -> Result<Vec<u8>> {
        Ok(self.public_path()?.as_bytes().to_vec())
    }

    #[cfg(not(unix))]
    fn key(&self) -> Result<Vec<u8>> {
        Ok(self.path.as_bytes().to_vec())
    }
}

pub fn compact(path: &Path) -> Result<Vec<MetadataRecord>> {
    let records = load_compacted(path)?;
    write_records(path, records.values())?;
    Ok(records.into_values().collect())
}

/// In-memory working set over `metadata.jsonl`. The daemon writer loads it once
/// per drain tick, applies every upsert/remove in memory, and `flush`es a single
/// atomic write — instead of a full read+reserialize+fsync per dirty path.
pub struct MetadataStore {
    path: PathBuf,
    records: BTreeMap<Vec<u8>, MetadataRecord>,
    dirty: bool,
}

impl MetadataStore {
    pub fn load(path: &Path) -> Result<Self> {
        Ok(Self {
            path: path.to_path_buf(),
            records: load_compacted(path)?,
            dirty: false,
        })
    }

    pub fn upsert(&mut self, record: MetadataRecord) -> Result<()> {
        self.records.insert(record.key()?, record);
        self.dirty = true;
        Ok(())
    }

    #[cfg(unix)]
    pub fn remove(&mut self, public_path: &PublicPath) {
        if self.records.remove(public_path.as_bytes()).is_some() {
            self.dirty = true;
        }
    }

    #[cfg(unix)]
    pub fn remove_subtree(&mut self, public_path: &PublicPath) {
        let before = self.records.len();
        self.records
            .retain(|key, _| !path_is_at_or_below(key, public_path.as_bytes()));
        if self.records.len() != before {
            self.dirty = true;
        }
    }

    pub fn flush(&mut self) -> Result<()> {
        if !self.dirty {
            return Ok(());
        }
        write_records(&self.path, self.records.values())?;
        self.dirty = false;
        Ok(())
    }
}

pub fn upsert(path: &Path, record: MetadataRecord) -> Result<()> {
    let mut store = MetadataStore::load(path)?;
    store.upsert(record)?;
    store.flush()
}

#[cfg(unix)]
pub fn remove(path: &Path, public_path: &PublicPath) -> Result<()> {
    let mut store = MetadataStore::load(path)?;
    store.remove(public_path);
    store.flush()
}

#[cfg(unix)]
pub fn remove_subtree(path: &Path, public_path: &PublicPath) -> Result<()> {
    let mut store = MetadataStore::load(path)?;
    store.remove_subtree(public_path);
    store.flush()
}

#[cfg(not(unix))]
pub fn remove(path: &Path, public_path: &str) -> Result<()> {
    let mut records = load_compacted(path)?;
    if records.remove(public_path.as_bytes()).is_some() {
        write_records(path, records.values())?;
    }
    Ok(())
}

#[cfg(unix)]
fn path_is_at_or_below(path: &[u8], parent: &[u8]) -> bool {
    path == parent || (path.starts_with(parent) && path.get(parent.len()) == Some(&b'/'))
}

pub fn load(path: &Path) -> Result<Vec<MetadataRecord>> {
    Ok(load_compacted(path)?.into_values().collect())
}

pub fn replace(path: &Path, records: &[MetadataRecord]) -> Result<()> {
    write_records(path, records.iter())
}

fn load_compacted(path: &Path) -> Result<BTreeMap<Vec<u8>, MetadataRecord>> {
    ensure_real_file_or_missing(path)?;
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(BTreeMap::new());
        }
        Err(error) => return Err(error).with_context(|| format!("open {}", path.display())),
    };

    let mut records = BTreeMap::new();
    for (index, line) in BufReader::new(file).lines().enumerate() {
        let line = line.with_context(|| format!("read {} line {}", path.display(), index + 1))?;
        if line.trim().is_empty() {
            continue;
        }
        let record: MetadataRecord = serde_json::from_str(&line)
            .with_context(|| format!("parse {} line {}", path.display(), index + 1))?;
        records.insert(record.key()?, record);
    }
    Ok(records)
}

fn write_records<'a>(
    path: &Path,
    records: impl IntoIterator<Item = &'a MetadataRecord>,
) -> Result<()> {
    let parent = path
        .parent()
        .with_context(|| format!("metadata path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    ensure_real_dir(parent)?;
    ensure_real_file_or_missing(path)?;

    let temp = path.with_extension("jsonl.tmp");
    let _ = fs::remove_file(&temp);
    let mut data = Vec::new();
    for record in records {
        serde_json::to_writer(&mut data, record).context("encode metadata record")?;
        data.push(b'\n');
    }
    {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .with_context(|| format!("create {}", temp.display()))?;
        file.write_all(&data)
            .with_context(|| format!("write {}", temp.display()))?;
        file.sync_all()
            .with_context(|| format!("fsync {}", temp.display()))?;
    }
    fs::rename(&temp, path)
        .with_context(|| format!("publish metadata {} to {}", temp.display(), path.display()))?;
    fsync_parent(path)
}

fn fsync_parent(path: &Path) -> Result<()> {
    let parent = path
        .parent()
        .with_context(|| format!("metadata path has no parent: {}", path.display()))?;
    let dir = File::open(parent).with_context(|| format!("open {}", parent.display()))?;
    dir.sync_all()
        .with_context(|| format!("fsync {}", parent.display()))
}

fn ensure_real_file_or_missing(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(()),
        Ok(_) => anyhow::bail!("{} must be a real file", path.display()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| format!("stat {}", path.display())),
    }
}

fn ensure_real_dir(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(()),
        Ok(_) => anyhow::bail!("{} must be a real directory", path.display()),
        Err(error) => Err(error).with_context(|| format!("stat {}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::{MetadataRecord, MetadataStore, compact, load, remove, remove_subtree, upsert};
    use std::{fs, os::unix::fs::symlink};

    fn record(path: &str) -> MetadataRecord {
        MetadataRecord {
            version: 1,
            path: path.into(),
            path_bytes_b64: None,
            kind: "file".into(),
            mode: Some(0o644),
            uid: Some(0),
            gid: Some(0),
            mtime_ns: Some(1),
            symlink_target: None,
            symlink_target_bytes_b64: None,
            rdev_major: None,
            rdev_minor: None,
            hardlink_key: None,
            xattrs: None,
            acl: None,
            capability: None,
        }
    }

    #[test]
    fn metadata_store_batches_mutations_and_gates_writes_on_dirty() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("metadata.jsonl");

        // An unchanged store must not create the file (dirty-gated flush).
        let mut store = MetadataStore::load(&path).unwrap();
        store.flush().unwrap();
        assert!(!path.exists());

        // Many mutations stay in memory until a single flush — the whole point of
        // the per-tick batching (no per-path read/reserialize/fsync).
        store.upsert(record("/a")).unwrap();
        store.upsert(record("/b")).unwrap();
        store.upsert(record("/c")).unwrap();
        store.remove(&crate::public::PublicPath::parse("/a").unwrap());
        assert!(!path.exists());

        store.flush().unwrap();
        let mut loaded = load(&path).unwrap();
        loaded.sort_by(|l, r| l.path.cmp(&r.path));
        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].path, "/b");
        assert_eq!(loaded[1].path, "/c");

        // A re-loaded, unmutated store flush is a no-op and leaves no temp file.
        let mut store = MetadataStore::load(&path).unwrap();
        store.flush().unwrap();
        assert!(!path.with_extension("jsonl.tmp").exists());
    }

    #[test]
    fn metadata_jsonl_compacts_to_latest_record_by_path() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("metadata.jsonl");
        fs::write(
            &path,
            r#"{"path":"/a","kind":"file","mode":420}
{"path":"/a","kind":"file","mode":384}
{"path":"/b","kind":"dir"}
"#,
        )
        .unwrap();

        let records = compact(&path).unwrap();

        assert_eq!(records.len(), 2);
        assert_eq!(records[0].path, "/a");
        assert_eq!(records[0].mode, Some(384));
        assert_eq!(fs::read_to_string(&path).unwrap().lines().count(), 2);
    }

    #[test]
    fn upsert_and_remove_rewrite_current_state() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("metadata.jsonl");

        upsert(
            &path,
            MetadataRecord {
                version: 1,
                path: "/a".into(),
                path_bytes_b64: None,
                kind: "file".into(),
                mode: Some(0o644),
                uid: Some(0),
                gid: Some(0),
                mtime_ns: Some(1),
                symlink_target: None,
                symlink_target_bytes_b64: None,
                rdev_major: None,
                rdev_minor: None,
                hardlink_key: None,
                xattrs: None,
                acl: None,
                capability: None,
            },
        )
        .unwrap();
        remove(&path, &crate::public::PublicPath::parse("/a").unwrap()).unwrap();

        assert!(load(&path).unwrap().is_empty());
    }

    #[test]
    fn remove_subtree_keeps_similar_prefix_paths() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("metadata.jsonl");
        fs::write(
            &path,
            r#"{"path":"/a","kind":"dir"}
{"path":"/a/b","kind":"file"}
{"path":"/ab","kind":"file"}
"#,
        )
        .unwrap();

        remove_subtree(&path, &crate::public::PublicPath::parse("/a").unwrap()).unwrap();

        let records = load(&path).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].path, "/ab");
    }

    #[test]
    fn metadata_identity_can_use_non_utf8_path_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("metadata.jsonl");
        let public_path = crate::public::PublicPath::from_absolute_bytes(b"/bad-\xff").unwrap();
        let mut record = MetadataRecord {
            version: 1,
            path: String::new(),
            path_bytes_b64: None,
            kind: "file".into(),
            mode: Some(0o644),
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

        upsert(&path, record).unwrap();

        let loaded = load(&path).unwrap();
        assert_eq!(loaded[0].public_path().unwrap(), public_path);
        assert!(fs::read_to_string(&path).unwrap().contains("pathBytesB64"));
    }

    #[test]
    fn metadata_writes_reject_symlink_target() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("metadata.jsonl");
        let outside = temp.path().join("outside.jsonl");
        fs::write(&outside, "outside").unwrap();
        symlink(&outside, &path).unwrap();

        let error = upsert(
            &path,
            MetadataRecord {
                version: 1,
                path: "/a".into(),
                path_bytes_b64: None,
                kind: "file".into(),
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
            },
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("real file"));
        assert_eq!(fs::read_to_string(outside).unwrap(), "outside");
    }

    #[test]
    fn metadata_reads_reject_symlink_target() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("metadata.jsonl");
        let outside = temp.path().join("outside.jsonl");
        fs::write(&outside, "{}\n").unwrap();
        symlink(&outside, &path).unwrap();

        let error = load(&path).unwrap_err().to_string();

        assert!(error.contains("real file"));
    }

    #[test]
    fn metadata_ignores_and_replaces_crash_leftover_temp_file() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("metadata.jsonl");
        let leftover = path.with_extension("jsonl.tmp");
        fs::write(
            &path,
            r#"{"path":"/kept","kind":"file"}
"#,
        )
        .unwrap();
        fs::write(
            &leftover,
            r#"{"path":"/partial","kind":"file"}
"#,
        )
        .unwrap();

        let records = load(&path).unwrap();

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].public_path().unwrap().as_bytes(), b"/kept");

        upsert(
            &path,
            MetadataRecord {
                version: 1,
                path: "/new".into(),
                path_bytes_b64: None,
                kind: "file".into(),
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
            },
        )
        .unwrap();

        assert!(!leftover.exists());
        let records = load(&path).unwrap();
        assert_eq!(records.len(), 2);
        assert!(
            records
                .iter()
                .all(|record| record.public_path().unwrap().as_bytes() != b"/partial")
        );
    }
}
