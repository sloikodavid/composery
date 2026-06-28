//! Cross-language contract: the TS route reads this same `/data/api/keys.json`;
//! store path, JSON shape, and hex SHA-256 hashing must stay identical both sides.

use anyhow::{Context, Result, bail};
use base64::Engine as _;
use persistence::paths::volume_root;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const KEY_PREFIX: &str = "csy_";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyStore {
    pub version: u32,
    pub keys: Vec<KeyRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KeyRecord {
    pub id: String,
    pub name: String,
    pub prefix: String,
    pub hash: String,
    pub created_at: u64,
}

pub struct NewKey {
    pub secret: String,
    pub record: KeyRecord,
}

impl Default for KeyStore {
    fn default() -> Self {
        Self {
            version: 1,
            keys: Vec::new(),
        }
    }
}

impl KeyStore {
    pub fn create(&mut self, name: &str) -> Result<NewKey> {
        if name.trim().is_empty() {
            bail!("key name must not be empty");
        }
        let new = generate(name)?;
        self.keys.push(new.record.clone());
        Ok(new)
    }

    pub fn revoke(&mut self, id: &str) -> bool {
        let before = self.keys.len();
        self.keys.retain(|key| key.id != id);
        self.keys.len() != before
    }
}

pub fn store_path() -> PathBuf {
    volume_root().join("api").join("keys.json")
}

pub fn load(path: &Path) -> Result<KeyStore> {
    match fs::read(path) {
        Ok(data) => {
            serde_json::from_slice(&data).with_context(|| format!("parse {}", path.display()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(KeyStore::default()),
        Err(error) => Err(error).with_context(|| format!("read {}", path.display())),
    }
}

pub fn save(path: &Path, store: &KeyStore) -> Result<()> {
    let parent = path
        .parent()
        .with_context(|| format!("store path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
        .with_context(|| format!("chmod 0700 {}", parent.display()))?;

    let mut data = serde_json::to_vec_pretty(store).context("encode key store")?;
    data.push(b'\n');

    let temp = path.with_extension("json.tmp");
    let _ = fs::remove_file(&temp);
    {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)
            .with_context(|| format!("create {}", temp.display()))?;
        file.write_all(&data)
            .with_context(|| format!("write {}", temp.display()))?;
        file.sync_all()
            .with_context(|| format!("fsync {}", temp.display()))?;
    }
    fs::rename(&temp, path)
        .with_context(|| format!("publish {} to {}", temp.display(), path.display()))?;
    let dir = File::open(parent).with_context(|| format!("open {}", parent.display()))?;
    dir.sync_all()
        .with_context(|| format!("fsync {}", parent.display()))
}

pub fn hash_secret(secret: &str) -> String {
    format!("sha256:{}", hex_encode(&Sha256::digest(secret.as_bytes())))
}

fn generate(name: &str) -> Result<NewKey> {
    let mut secret_bytes = [0u8; 32];
    getrandom::getrandom(&mut secret_bytes)
        .map_err(|error| anyhow::anyhow!("getrandom: {error}"))?;
    let secret = format!(
        "{KEY_PREFIX}{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(secret_bytes)
    );

    let mut id_bytes = [0u8; 6];
    getrandom::getrandom(&mut id_bytes).map_err(|error| anyhow::anyhow!("getrandom: {error}"))?;
    let id = format!("k_{}", hex_encode(&id_bytes));

    let prefix: String = secret.chars().take(12).collect();

    Ok(NewKey {
        record: KeyRecord {
            id,
            name: name.to_string(),
            prefix,
            hash: hash_secret(&secret),
            created_at: now_secs(),
        },
        secret,
    })
}

fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_list_revoke_round_trip() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("api/keys.json");

        let mut store = load(&path).unwrap();
        assert!(store.keys.is_empty());
        let new = store.create("ci").unwrap();
        save(&path, &store).unwrap();

        let mut store = load(&path).unwrap();
        assert_eq!(store.keys.len(), 1);
        let record_id = store.keys[0].id.clone();
        assert_eq!(store.keys[0].name, "ci");
        assert!(new.secret.starts_with("csy_"));
        assert_eq!(store.keys[0].hash, hash_secret(&new.secret));

        assert!(store.revoke(&record_id));
        assert!(!store.revoke("k_does_not_exist"));
        save(&path, &store).unwrap();
        assert!(load(&path).unwrap().keys.is_empty());
    }

    #[test]
    fn hash_is_stable_known_vector() {
        assert_eq!(
            hash_secret(""),
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(hash_secret("csy_abc"), hash_secret("csy_abc"));
    }

    #[test]
    fn empty_name_rejected() {
        let mut store = KeyStore::default();
        assert!(store.create("   ").is_err());
    }

    #[test]
    fn store_file_is_private() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("api/keys.json");
        let mut store = KeyStore::default();
        store.create("ci").unwrap();
        save(&path, &store).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        assert!(!path.with_extension("json.tmp").exists());
    }
}
