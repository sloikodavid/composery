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
}

impl Default for Config {
    fn default() -> Self {
        Self {
            exclusions: vec![
                "/data".into(),
                "/run".into(),
                "/proc".into(),
                "/sys".into(),
                "/dev".into(),
                "/tmp".into(),
                "/var/run".into(),
                "/opt/persistd".into(),
                "/opt/composery".into(),
                "/etc/hostname".into(),
                "/etc/hosts".into(),
                "/etc/resolv.conf".into(),
            ],
            audit: AuditConfig {
                max_work_ms_per_tick: 10,
            },
        }
    }
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
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => {
            let data = fs::read(path).with_context(|| format!("read config {}", path.display()))?;
            let config: Config = serde_json::from_slice(&data)
                .with_context(|| format!("parse config {}", path.display()))?;
            config
                .validate()
                .with_context(|| format!("validate config {}", path.display()))?;
            Ok(config)
        }
        Ok(_) => anyhow::bail!("{} must be a real file", path.display()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let config = Config::default();
            config.validate().context("validate default config")?;
            write(path, &config)?;
            Ok(config)
        }
        Err(error) => Err(error).with_context(|| format!("stat config {}", path.display())),
    }
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
        let path = temp.path().join("persistd/config.json");

        let config = load_or_create(&path).unwrap();

        assert_eq!(config, Config::default());
        assert!(path.exists());
        let reparsed = load_or_create(&path).unwrap();
        assert_eq!(reparsed, Config::default());
    }

    #[test]
    fn load_or_create_rejects_invalid_exclusions() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("persistd/config.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let mut config = Config::default();
        config.exclusions.push("relative".into());
        fs::write(&path, serde_json::to_vec(&config).unwrap()).unwrap();

        let error = load_or_create(&path).unwrap_err().to_string();

        assert!(error.contains("validate config"));
    }

    #[test]
    fn load_or_create_rejects_config_symlinks() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("persistd/config.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let outside = temp.path().join("outside-config.json");
        fs::write(&outside, "{}").unwrap();
        std::os::unix::fs::symlink(&outside, &path).unwrap();

        let error = load_or_create(&path).unwrap_err().to_string();

        assert!(error.contains("real file"));
    }

    #[test]
    fn load_or_create_rejects_symlink_parent() {
        let temp = tempfile::tempdir().unwrap();
        let outside = temp.path().join("outside");
        let parent = temp.path().join("persistd");
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, &parent).unwrap();

        let error = load_or_create(&parent.join("config.json"))
            .unwrap_err()
            .to_string();

        assert!(error.contains("real directory"));
        assert!(!outside.join("config.json").exists());
    }
}
