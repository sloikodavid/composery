use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::Path,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub exclusions: Vec<String>,
    pub audit: AuditConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditConfig {
    pub max_work_ms_per_tick: u64,
    /// Pause between rolling audit passes. The inotify watcher catches changes
    /// live; the audit only recovers missed events, so a full-rootfs walk does
    /// not need to run back to back. Serde default keeps pre-existing
    /// config.json files on deployed volumes parsing.
    #[serde(default = "default_interval_secs")]
    pub interval_secs: u64,
    /// Frequent audit passes trust size+mtime; a deep pass re-hashes every file
    /// to catch mtime-preserving edits. Serde default keeps pre-existing
    /// config.json files on deployed volumes parsing.
    #[serde(default = "default_deep_hash_interval_secs")]
    pub deep_hash_interval_secs: u64,
}

fn default_interval_secs() -> u64 {
    60
}

fn default_deep_hash_interval_secs() -> u64 {
    3600
}

impl Default for Config {
    fn default() -> Self {
        with_required_exclusions(Self {
            exclusions: vec!["/var/cache".into()],
            audit: AuditConfig {
                max_work_ms_per_tick: 10,
                interval_secs: default_interval_secs(),
                deep_hash_interval_secs: default_deep_hash_interval_secs(),
            },
        })
    }
}

fn required_exclusions() -> Vec<String> {
    vec![
        crate::paths::volume_root().to_string_lossy().into_owned(),
        "/run".into(),
        "/proc".into(),
        "/sys".into(),
        "/dev".into(),
        "/tmp".into(),
        "/var/run".into(),
        "/opt/persistence".into(),
        "/opt/composery".into(),
        "/etc/hostname".into(),
        "/etc/hosts".into(),
        "/etc/resolv.conf".into(),
    ]
}

fn with_required_exclusions(mut config: Config) -> Config {
    let mut exclusions = required_exclusions();
    for exclusion in config.exclusions.drain(..) {
        if !exclusions.contains(&exclusion) {
            exclusions.push(exclusion);
        }
    }
    config.exclusions = exclusions;
    config
}

fn file_default() -> Config {
    let mut config = Config::default();
    let required = required_exclusions();
    config
        .exclusions
        .retain(|exclusion| !required.contains(exclusion));
    config
}

impl Config {
    pub fn validate(&self) -> Result<()> {
        for exclusion in &self.exclusions {
            validate_exclusion(exclusion)
                .with_context(|| format!("invalid exclusion {exclusion:?}"))?;
        }
        Ok(())
    }
}

pub fn load_or_create(path: &Path) -> Result<Config> {
    let parent = path
        .parent()
        .with_context(|| format!("config path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .with_context(|| format!("create config dir {}", parent.display()))?;
    ensure_real_dir(parent)?;

    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => {
            let loaded = fs::read(path)
                .with_context(|| format!("read config {}", path.display()))
                .and_then(|data| {
                    serde_json::from_slice::<Config>(&data)
                        .with_context(|| format!("parse config {}", path.display()))
                })
                .and_then(|config| {
                    config
                        .validate()
                        .with_context(|| format!("validate config {}", path.display()))?;
                    Ok(config)
                });
            match loaded {
                Ok(config) => Ok(with_required_exclusions(config)),
                Err(error) => recover_invalid(path, &error),
            }
        }
        Ok(_) => recover_invalid(
            path,
            &anyhow::anyhow!("{} must be a real file", path.display()),
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => create_default(path),
        Err(error) => Err(error).with_context(|| format!("stat config {}", path.display())),
    }
}

fn create_default(path: &Path) -> Result<Config> {
    let config = file_default();
    config.validate().context("validate default config")?;
    write(path, &config)?;
    Ok(with_required_exclusions(config))
}

fn recover_invalid(path: &Path, error: &anyhow::Error) -> Result<Config> {
    let backup = unused_invalid_path(path)?;
    fs::rename(path, &backup).with_context(|| {
        format!(
            "preserve invalid config {} as {}",
            path.display(),
            backup.display()
        )
    })?;
    rootfs_fsync_parent(path)?;
    tracing::warn!(
        error = %error,
        backup = %backup.display(),
        "replaced invalid persistence config with safe defaults"
    );
    create_default(path)
}

fn unused_invalid_path(path: &Path) -> Result<std::path::PathBuf> {
    let source_is_dir = fs::symlink_metadata(path)
        .with_context(|| format!("stat invalid config {}", path.display()))?
        .file_type()
        .is_dir();
    for sequence in 1..=10_000 {
        let candidate = path.with_extension(format!("invalid-{sequence}.json"));
        let reserved = if source_is_dir {
            fs::create_dir(&candidate)
        } else {
            OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&candidate)
                .map(drop)
        };
        match reserved {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(error).with_context(|| format!("reserve {}", candidate.display()));
            }
        }
    }
    bail!(
        "too many preserved invalid configs next to {}",
        path.display()
    )
}

fn write(path: &Path, config: &Config) -> Result<()> {
    let parent = path
        .parent()
        .with_context(|| format!("config path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .with_context(|| format!("create config dir {}", parent.display()))?;
    ensure_real_dir(parent)?;

    let mut data = serde_json::to_vec_pretty(config).context("encode default config")?;
    data.push(b'\n');
    let temp = path.with_extension("json.tmp");
    let _ = fs::remove_file(&temp);
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
        .with_context(|| format!("publish config {} to {}", temp.display(), path.display()))?;
    let dir = File::open(parent).with_context(|| format!("open {}", parent.display()))?;
    dir.sync_all()
        .with_context(|| format!("fsync {}", parent.display()))
}

fn rootfs_fsync_parent(path: &Path) -> Result<()> {
    let parent = path
        .parent()
        .with_context(|| format!("config path has no parent: {}", path.display()))?;
    let dir = File::open(parent).with_context(|| format!("open {}", parent.display()))?;
    dir.sync_all()
        .with_context(|| format!("fsync {}", parent.display()))
}

fn ensure_real_dir(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_dir() => Ok(()),
        Ok(_) => anyhow::bail!("{} must be a real directory", path.display()),
        Err(error) => Err(error).with_context(|| format!("stat {}", path.display())),
    }
}

fn validate_exclusion(value: &str) -> Result<()> {
    let bytes = value.as_bytes();
    if bytes.first() != Some(&b'/') {
        bail!("path must be absolute");
    }
    if bytes.contains(&0) {
        bail!("path contains NUL");
    }

    let mut has_component = false;
    for component in bytes.split(|byte| *byte == b'/') {
        if component.is_empty() || component == b"." {
            continue;
        }
        if component == b".." {
            bail!("path cannot contain '..'");
        }
        has_component = true;
    }

    if !has_component {
        bail!("root path cannot be excluded");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{Config, load_or_create};
    use std::fs;

    #[test]
    fn load_or_create_writes_default_config() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("persistence/config.json");

        let config = load_or_create(&path).unwrap();

        assert_eq!(config, Config::default());
        assert!(path.exists());
        let stored: Config = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(stored.exclusions, vec!["/var/cache"]);
        let reparsed = load_or_create(&path).unwrap();
        assert_eq!(reparsed, Config::default());
    }

    #[test]
    fn config_without_deep_hash_interval_parses_with_default() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("persistence/config.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"exclusions":["/data"],"audit":{"maxWorkMsPerTick":10}}"#,
        )
        .unwrap();

        let config = load_or_create(&path).unwrap();

        assert_eq!(config.audit.deep_hash_interval_secs, 3600);
    }

    #[test]
    fn required_exclusions_cannot_be_removed_from_the_file() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("persistence/config.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            &path,
            r#"{"exclusions":[],"audit":{"maxWorkMsPerTick":10}}"#,
        )
        .unwrap();

        let config = load_or_create(&path).unwrap();

        for required in ["/data", "/proc", "/opt/persistence", "/opt/composery"] {
            assert!(config.exclusions.iter().any(|value| value == required));
        }
        let stored: Config = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert!(stored.exclusions.is_empty());
    }

    #[test]
    fn load_or_create_preserves_and_recovers_invalid_exclusions() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("persistence/config.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut config = Config::default();
        config.exclusions.push("relative".into());
        fs::write(&path, serde_json::to_vec(&config).unwrap()).unwrap();

        let recovered = load_or_create(&path).unwrap();

        assert_eq!(recovered, Config::default());
        assert!(path.with_extension("invalid-1.json").is_file());
        let stored: Config = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
        assert_eq!(stored.exclusions, vec!["/var/cache"]);
    }

    #[test]
    fn load_or_create_preserves_and_recovers_config_symlinks() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("persistence/config.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let outside = temp.path().join("outside-config.json");
        fs::write(&outside, "{}").unwrap();
        std::os::unix::fs::symlink(&outside, &path).unwrap();

        let recovered = load_or_create(&path).unwrap();

        assert_eq!(recovered, Config::default());
        assert_eq!(
            fs::read_link(path.with_extension("invalid-1.json")).unwrap(),
            outside
        );
        assert!(path.is_file());
    }

    #[test]
    fn load_or_create_preserves_and_recovers_malformed_json() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("persistence/config.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{not json").unwrap();

        let recovered = load_or_create(&path).unwrap();

        assert_eq!(recovered, Config::default());
        assert_eq!(
            fs::read_to_string(path.with_extension("invalid-1.json")).unwrap(),
            "{not json"
        );
    }

    #[test]
    fn load_or_create_rejects_symlink_parent() {
        let temp = tempfile::tempdir().unwrap();
        let outside = temp.path().join("outside");
        let parent = temp.path().join("persistence");
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, &parent).unwrap();

        let error = load_or_create(&parent.join("config.json"))
            .unwrap_err()
            .to_string();

        assert!(error.contains("real directory"));
        assert!(!outside.join("config.json").exists());
    }
}
