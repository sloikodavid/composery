#![cfg(unix)]

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    os::unix::{
        ffi::OsStrExt,
        fs::{MetadataExt, PermissionsExt, symlink},
    },
    path::Path,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityReport {
    pub chmod: CapabilityState,
    pub chown: CapabilityState,
    pub mtimes: CapabilityState,
    pub symlinks: CapabilityState,
    pub hardlinks: CapabilityState,
    pub xattrs: CapabilityState,
    pub acls: CapabilityState,
    pub file_capabilities: CapabilityState,
    pub fifos: CapabilityState,
    pub device_nodes: CapabilityState,
    pub sparse_files: CapabilityState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityState {
    pub supported: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl CapabilityState {
    fn supported() -> Self {
        Self {
            supported: true,
            error: None,
        }
    }

    fn unsupported(error: impl ToString) -> Self {
        Self {
            supported: false,
            error: Some(error.to_string()),
        }
    }
}

pub fn probe(volume_dir: &Path) -> Result<CapabilityReport> {
    fs::create_dir_all(volume_dir).with_context(|| format!("create {}", volume_dir.display()))?;
    let probe_dir = volume_dir.join(".internal/capability-probe");
    let _ = fs::remove_dir_all(&probe_dir);
    fs::create_dir_all(&probe_dir).with_context(|| format!("create {}", probe_dir.display()))?;

    let report = CapabilityReport {
        chmod: probe_chmod(&probe_dir),
        chown: probe_chown(&probe_dir),
        mtimes: probe_mtimes(&probe_dir),
        symlinks: probe_symlinks(&probe_dir),
        hardlinks: probe_hardlinks(&probe_dir),
        xattrs: probe_xattrs(&probe_dir),
        acls: probe_acls(&probe_dir),
        file_capabilities: probe_file_capabilities(&probe_dir),
        fifos: probe_fifos(&probe_dir),
        device_nodes: probe_devices(&probe_dir),
        sparse_files: probe_sparse(&probe_dir),
    };
    let _ = fs::remove_dir_all(&probe_dir);
    Ok(report)
}

fn probe_chmod(dir: &Path) -> CapabilityState {
    let path = dir.join("chmod");
    (|| -> Result<()> {
        fs::write(&path, "x")?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        anyhow::ensure!(
            fs::metadata(&path)?.permissions().mode() & 0o777 == 0o600,
            "chmod value mismatch"
        );
        Ok(())
    })()
    .map(|_| CapabilityState::supported())
    .unwrap_or_else(CapabilityState::unsupported)
}

fn probe_chown(dir: &Path) -> CapabilityState {
    let path = dir.join("chown");
    (|| -> Result<()> {
        fs::write(&path, "x")?;
        let metadata = fs::metadata(&path)?;
        if metadata.uid() != 0 {
            anyhow::bail!("ownership change probe requires root");
        }
        let c_path = std::ffi::CString::new(path.as_os_str().as_bytes())?;
        let result = unsafe { libc::lchown(c_path.as_ptr(), 1, 1) };
        if result != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        let changed = fs::metadata(&path)?;
        anyhow::ensure!(
            changed.uid() == 1 && changed.gid() == 1,
            "chown value mismatch"
        );
        Ok(())
    })()
    .map(|_| CapabilityState::supported())
    .unwrap_or_else(CapabilityState::unsupported)
}

fn probe_mtimes(dir: &Path) -> CapabilityState {
    let path = dir.join("mtime");
    (|| -> Result<()> {
        fs::write(&path, "x")?;
        filetime::set_file_mtime(&path, filetime::FileTime::from_unix_time(123, 456))?;
        let metadata = fs::metadata(&path)?;
        anyhow::ensure!(
            metadata.mtime() == 123 && metadata.mtime_nsec() == 456,
            "mtime value mismatch"
        );
        Ok(())
    })()
    .map(|_| CapabilityState::supported())
    .unwrap_or_else(CapabilityState::unsupported)
}

fn probe_symlinks(dir: &Path) -> CapabilityState {
    let target = dir.join("symlink-target");
    let link = dir.join("symlink-link");
    (|| -> Result<()> {
        fs::write(&target, "x")?;
        symlink(&target, &link)?;
        anyhow::ensure!(fs::read_link(&link)? == target, "symlink target mismatch");
        Ok(())
    })()
    .map(|_| CapabilityState::supported())
    .unwrap_or_else(CapabilityState::unsupported)
}

fn probe_hardlinks(dir: &Path) -> CapabilityState {
    let source = dir.join("hardlink-source");
    let target = dir.join("hardlink-target");
    (|| -> Result<()> {
        fs::write(&source, "x")?;
        fs::hard_link(&source, &target)?;
        let left = fs::metadata(&source)?;
        let right = fs::metadata(&target)?;
        anyhow::ensure!(left.ino() == right.ino(), "hardlink inode mismatch");
        Ok(())
    })()
    .map(|_| CapabilityState::supported())
    .unwrap_or_else(CapabilityState::unsupported)
}

fn probe_xattrs(dir: &Path) -> CapabilityState {
    let path = dir.join("xattr");
    (|| -> Result<()> {
        fs::write(&path, "x")?;
        xattr::set(&path, "user.persistence-probe", b"ok")?;
        anyhow::ensure!(
            xattr::get(&path, "user.persistence-probe")? == Some(b"ok".to_vec()),
            "xattr value mismatch"
        );
        Ok(())
    })()
    .map(|_| CapabilityState::supported())
    .unwrap_or_else(CapabilityState::unsupported)
}

fn probe_acls(dir: &Path) -> CapabilityState {
    let path = dir.join("acl");
    (|| -> Result<()> {
        fs::write(&path, "x")?;
        let value = acl_xattr_value(0o640);
        xattr::set(&path, "system.posix_acl_access", &value)?;
        anyhow::ensure!(
            xattr::get(&path, "system.posix_acl_access")? == Some(value),
            "ACL xattr value mismatch"
        );
        Ok(())
    })()
    .map(|_| CapabilityState::supported())
    .unwrap_or_else(CapabilityState::unsupported)
}

fn probe_file_capabilities(dir: &Path) -> CapabilityState {
    let path = dir.join("file-capability");
    (|| -> Result<()> {
        fs::write(&path, "#!/bin/sh\n")?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755))?;
        let value = file_capability_xattr_value();
        xattr::set(&path, "security.capability", &value)?;
        anyhow::ensure!(
            xattr::get(&path, "security.capability")? == Some(value),
            "file capability xattr value mismatch"
        );
        Ok(())
    })()
    .map(|_| CapabilityState::supported())
    .unwrap_or_else(CapabilityState::unsupported)
}

fn probe_fifos(dir: &Path) -> CapabilityState {
    let path = dir.join("fifo");
    (|| -> Result<()> {
        let c = std::ffi::CString::new(path.as_os_str().as_bytes())?;
        let result = unsafe { libc::mkfifo(c.as_ptr(), 0o600) };
        if result != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(())
    })()
    .map(|_| CapabilityState::supported())
    .unwrap_or_else(CapabilityState::unsupported)
}

fn probe_devices(dir: &Path) -> CapabilityState {
    let path = dir.join("null-device");
    (|| -> Result<()> {
        let c = std::ffi::CString::new(path.as_os_str().as_bytes())?;
        let dev = ((1u64 << 8) | 3u64) as libc::dev_t;
        let result = unsafe { libc::mknod(c.as_ptr(), libc::S_IFCHR | 0o600, dev) };
        if result != 0 {
            return Err(std::io::Error::last_os_error().into());
        }
        Ok(())
    })()
    .map(|_| CapabilityState::supported())
    .unwrap_or_else(CapabilityState::unsupported)
}

fn probe_sparse(dir: &Path) -> CapabilityState {
    let path = dir.join("sparse");
    (|| -> Result<()> {
        let mut file = fs::File::create(&path)?;
        file.write_all(b"a")?;
        file.set_len(16 * 1024 * 1024)?;
        file.write_all(b"z")?;
        drop(file);
        let metadata = fs::metadata(&path)?;
        anyhow::ensure!(
            metadata.blocks() * 512 < metadata.len(),
            "filesystem expanded sparse file"
        );
        Ok(())
    })()
    .map(|_| CapabilityState::supported())
    .unwrap_or_else(CapabilityState::unsupported)
}

fn acl_xattr_value(mode: u16) -> Vec<u8> {
    const ACL_USER_OBJ: u16 = 0x01;
    const ACL_GROUP_OBJ: u16 = 0x04;
    const ACL_OTHER: u16 = 0x20;
    let mut value = Vec::new();
    push_u32(&mut value, 2);
    push_acl_entry(&mut value, ACL_USER_OBJ, (mode >> 6) & 0o7);
    push_acl_entry(&mut value, ACL_GROUP_OBJ, (mode >> 3) & 0o7);
    push_acl_entry(&mut value, ACL_OTHER, mode & 0o7);
    value
}

fn push_acl_entry(value: &mut Vec<u8>, tag: u16, permissions: u16) {
    value.extend_from_slice(&tag.to_le_bytes());
    value.extend_from_slice(&permissions.to_le_bytes());
    value.extend_from_slice(&u32::MAX.to_le_bytes());
}

fn file_capability_xattr_value() -> Vec<u8> {
    const VFS_CAP_REVISION_2: u32 = 0x0200_0000;
    const VFS_CAP_FLAGS_EFFECTIVE: u32 = 0x0000_0001;
    const CAP_NET_BIND_SERVICE: u32 = 10;
    let mut value = Vec::new();
    push_u32(&mut value, VFS_CAP_REVISION_2 | VFS_CAP_FLAGS_EFFECTIVE);
    push_u32(&mut value, 1 << CAP_NET_BIND_SERVICE);
    push_u32(&mut value, 0);
    push_u32(&mut value, 0);
    push_u32(&mut value, 0);
    value
}

fn push_u32(value: &mut Vec<u8>, item: u32) {
    value.extend_from_slice(&item.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::probe;

    #[test]
    fn probe_reports_volume_capabilities() {
        let temp = tempfile::tempdir().unwrap();
        let report = probe(temp.path()).unwrap();

        assert!(report.hardlinks.supported);
        assert!(report.xattrs.supported);
        assert!(report.fifos.supported);
        assert!(report.chmod.supported);
        assert!(report.mtimes.supported);
        assert!(report.symlinks.supported);
        assert!(report.chown.supported || report.chown.error.is_some());
        assert!(report.acls.supported || report.acls.error.is_some());
        assert!(report.file_capabilities.supported || report.file_capabilities.error.is_some());
    }
}
