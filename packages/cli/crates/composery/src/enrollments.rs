//! SSH enrollment tokens.
//!
//! Cross-language contract: the TS route in
//! `packages/ide/overlay/src/node/routes/api/sshCertificates.ts` reads and writes
//! this same `<volume>/ssh/enrollments.json`. The path, the bare-array JSON
//! shape, the `"sha256:" + hex` hashing and the **millisecond** `expires_at` must
//! stay identical on both sides. `tests/invariants/keystore-contract.test.ts`
//! pins the pair.
//!
//! Two processes need this, which is the whole reason it is a file: the editor's
//! extension host mints a token by running this CLI, and the instance's server
//! process redeems it. Anything held in memory would mint tokens nothing could
//! ever redeem.
//!
//! Only the hash is stored, so the file holds no usable credential - what
//! survives on the volume is a claim check, not a secret.

use anyhow::{Context, Result, bail};
use base64::Engine as _;
use persistence::paths::volume_root;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use crate::keystore::hash_secret;

const TOKEN_PREFIX: &str = "composery_ssh_";
const DEFAULT_TTL_SECS: u64 = 600;
const MAX_TTL_SECS: u64 = 3600;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EnrollmentRecord {
    pub expires_at: u64,
    pub hash: String,
    pub name: String,
}

pub struct NewEnrollment {
    pub token: String,
    pub expires_at: u64,
}

pub fn store_path() -> PathBuf {
    volume_root().join("ssh").join("enrollments.json")
}

/// Seconds a minted token stays redeemable. Clamped rather than trusted for the
/// same reason every other owner-settable bound here is: the value comes from an
/// environment the owner controls, and a token that never expires is the one
/// outcome this must not silently produce.
pub fn ttl_secs() -> u64 {
    std::env::var("COMPOSERY_SSH_ENROLLMENT_TTL")
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .map(|value| value.min(MAX_TTL_SECS))
        .unwrap_or(DEFAULT_TTL_SECS)
}

/// Expired records are dropped on every write, so copying prompts cannot grow the
/// file without bound.
pub fn live(records: Vec<EnrollmentRecord>, now_ms: u64) -> Vec<EnrollmentRecord> {
    records
        .into_iter()
        .filter(|record| record.expires_at > now_ms)
        .collect()
}

pub fn load(path: &Path) -> Result<Vec<EnrollmentRecord>> {
    match fs::read(path) {
        Ok(data) => {
            serde_json::from_slice(&data).with_context(|| format!("parse {}", path.display()))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(error) => Err(error).with_context(|| format!("open {}", path.display())),
    }
}

pub fn save(path: &Path, records: &[EnrollmentRecord]) -> Result<()> {
    let parent = path
        .parent()
        .with_context(|| format!("store path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent).with_context(|| format!("create {}", parent.display()))?;
    fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
        .with_context(|| format!("chmod 0700 {}", parent.display()))?;

    // No trailing newline and no pretty-printing: the TS side writes
    // `JSON.stringify(records)`, and one file written two ways is a file whose
    // shape nobody can assert.
    let data = serde_json::to_vec(records).context("encode enrollment store")?;

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
        // Match the directory's owner, so a sudo-run CLI never leaves a
        // root-owned store the server process cannot rewrite when it redeems.
        let parent_metadata =
            fs::metadata(parent).with_context(|| format!("stat {}", parent.display()))?;
        let _ = unsafe {
            libc::fchown(
                std::os::unix::io::AsRawFd::as_raw_fd(&file),
                parent_metadata.uid(),
                parent_metadata.gid(),
            )
        };
        file.sync_all()
            .with_context(|| format!("fsync {}", temp.display()))?;
    }
    fs::rename(&temp, path)
        .with_context(|| format!("publish {} to {}", temp.display(), path.display()))
}

pub fn mint(name: &str, now_ms: u64) -> Result<(NewEnrollment, EnrollmentRecord)> {
    if name.trim().is_empty() {
        bail!("enrollment name must not be empty");
    }
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).map_err(|error| anyhow::anyhow!("getrandom: {error}"))?;
    let token = format!(
        "{TOKEN_PREFIX}{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    );
    let expires_at = now_ms + ttl_secs() * 1000;
    let record = EnrollmentRecord {
        expires_at,
        hash: hash_secret(&token),
        name: name.trim().to_string(),
    };
    Ok((NewEnrollment { token, expires_at }, record))
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_minted_token_is_stored_only_as_a_hash() {
        let (new, record) = mint("laptop", 1_000).expect("mint");
        assert!(new.token.starts_with(TOKEN_PREFIX));
        assert!(record.hash.starts_with("sha256:"));
        assert_ne!(record.hash, new.token);
        assert_eq!(record.hash, hash_secret(&new.token));
    }

    #[test]
    fn expiry_is_milliseconds_past_the_moment_it_was_minted() {
        let (new, _) = mint("laptop", 1_000).expect("mint");
        assert_eq!(new.expires_at, 1_000 + ttl_secs() * 1000);
    }

    #[test]
    fn an_empty_name_is_refused_rather_than_stored() {
        assert!(mint("   ", 0).is_err());
    }

    #[test]
    fn expired_records_are_dropped_and_live_ones_kept() {
        let records = vec![
            EnrollmentRecord {
                expires_at: 50,
                hash: "sha256:a".into(),
                name: "old".into(),
            },
            EnrollmentRecord {
                expires_at: 150,
                hash: "sha256:b".into(),
                name: "new".into(),
            },
        ];
        let kept = live(records, 100);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].name, "new");
    }

    // The store the TS side reads is a bare array, not an object with a version.
    #[test]
    fn the_store_round_trips_as_a_bare_array() {
        let records = vec![EnrollmentRecord {
            expires_at: 1,
            hash: "sha256:a".into(),
            name: "laptop".into(),
        }];
        let encoded = serde_json::to_string(&records).expect("encode");
        assert!(encoded.starts_with('['));
        assert!(encoded.contains("\"expires_at\":1"));
        let decoded: Vec<EnrollmentRecord> = serde_json::from_str(&encoded).expect("decode");
        assert_eq!(decoded, records);
    }
}
