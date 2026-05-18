#![allow(dead_code)]

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{BufRead, BufReader},
    path::Path,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataRecord {
    pub path: String,
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
    pub xattrs: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acl: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability: Option<Value>,
}

pub fn compact(path: &Path) -> Result<Vec<MetadataRecord>> {
    let records = load_compacted(path)?;
    write_records(path, records.values())?;
    Ok(records.into_values().collect())
}

pub fn upsert(path: &Path, record: MetadataRecord) -> Result<()> {
    let mut records = load_compacted(path)?;
    records.insert(record.path.clone(), record);
    write_records(path, records.values())
}

pub fn remove(path: &Path, public_path: &str) -> Result<()> {
    let mut records = load_compacted(path)?;
    if records.remove(public_path).is_some() {
        write_records(path, records.values())?;
    }
    Ok(())
}

pub fn load(path: &Path) -> Result<Vec<MetadataRecord>> {
    Ok(load_compacted(path)?.into_values().collect())
}

fn load_compacted(path: &Path) -> Result<BTreeMap<String, MetadataRecord>> {
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
        records.insert(record.path.clone(), record);
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

    let temp = path.with_extension("jsonl.tmp");
    let mut data = Vec::new();
    for record in records {
        serde_json::to_writer(&mut data, record).context("encode metadata record")?;
        data.push(b'\n');
    }
    fs::write(&temp, data).with_context(|| format!("write {}", temp.display()))?;
    fs::rename(&temp, path)
        .with_context(|| format!("publish metadata {} to {}", temp.display(), path.display()))
}

#[cfg(test)]
mod tests {
    use super::{MetadataRecord, compact, load, remove, upsert};
    use std::fs;

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
                path: "/a".into(),
                kind: "file".into(),
                mode: Some(0o644),
                uid: Some(0),
                gid: Some(0),
                mtime_ns: Some(1),
                symlink_target: None,
                xattrs: None,
                acl: None,
                capability: None,
            },
        )
        .unwrap();
        remove(&path, "/a").unwrap();

        assert!(load(&path).unwrap().is_empty());
    }
}
