use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::{
    baseline::BaselineDb, capabilities::CapabilityReport, internal::StateDb, paths::Paths,
};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusReport {
    pub ready: bool,
    pub phase: String,
    pub last_apply_success_at: Option<String>,
    pub last_apply_failure_at: Option<String>,
    pub last_apply_error: Option<String>,
    pub last_daemon_success_at: Option<String>,
    pub last_daemon_failure_at: Option<String>,
    pub last_daemon_error: Option<String>,
    pub watch_status: String,
    pub audit_status: String,
    pub last_error: Option<String>,
    pub baseline_present: bool,
    pub baseline_valid: bool,
    pub capabilities: Option<CapabilityReport>,
    pub dirty_queue_size: u64,
    pub public_counts: PublicCounts,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicCounts {
    pub changed: u64,
    pub removed: u64,
    pub metadata: u64,
}

pub fn build(paths: &Paths, db: &StateDb) -> Result<StatusReport> {
    build_with_runtime(paths, db, RuntimeStatus::default())
}

#[derive(Debug, Clone, Default)]
pub struct RuntimeStatus {
    pub dirty_queue_size: u64,
    pub watch_status: Option<String>,
    pub audit_status: Option<String>,
}

pub fn build_with_runtime(
    paths: &Paths,
    db: &StateDb,
    runtime: RuntimeStatus,
) -> Result<StatusReport> {
    let ready = ready_file_exists(paths);
    let baseline_present = paths.baseline_db.exists();
    let baseline_valid = baseline_present && BaselineDb::open(&paths.baseline_db).is_ok();
    let last_error = db
        .meta_value("last_error")?
        .filter(|value| !value.is_empty());
    let capabilities = db
        .meta_value("diagnostic_capabilities")?
        .and_then(|value| serde_json::from_str(&value).ok());
    let watch_status = match runtime.watch_status {
        Some(status) => status,
        None => db
            .meta_value("diagnostic_watch_status")?
            .unwrap_or_else(|| "unknown".into()),
    };
    let audit_status = match runtime.audit_status {
        Some(status) => status,
        None => db
            .meta_value("diagnostic_audit_status")?
            .unwrap_or_else(|| "unknown".into()),
    };
    Ok(StatusReport {
        ready,
        phase: if ready {
            "ready".into()
        } else {
            "starting".into()
        },
        last_apply_success_at: db.meta_value("last_apply_success_at")?,
        last_apply_failure_at: db.meta_value("last_apply_failure_at")?,
        last_apply_error: db
            .meta_value("last_apply_error")?
            .filter(|value| !value.is_empty()),
        last_daemon_success_at: db.meta_value("last_daemon_success_at")?,
        last_daemon_failure_at: db.meta_value("last_daemon_failure_at")?,
        last_daemon_error: db
            .meta_value("last_daemon_error")?
            .filter(|value| !value.is_empty()),
        watch_status,
        audit_status,
        last_error,
        baseline_present,
        baseline_valid,
        capabilities,
        dirty_queue_size: runtime.dirty_queue_size,
        public_counts: PublicCounts {
            changed: db.public_count("changed")?,
            removed: db.public_count("removed")?,
            metadata: db.metadata_record_count()?,
        },
    })
}

fn ready_file_exists(paths: &Paths) -> bool {
    std::fs::symlink_metadata(&paths.ready_file)
        .is_ok_and(|metadata| metadata.file_type().is_file())
}

pub fn print_human(report: &StatusReport) {
    println!("persistd status:");
    println!("  ready: {}", report.ready);
    println!("  phase: {}", report.phase);
    println!("  baseline: {}", report.baseline_present);
    println!("  baselineValid: {}", report.baseline_valid);
    println!("  watch: {}", report.watch_status);
    println!("  audit: {}", report.audit_status);
    println!("  dirtyQueueSize: {}", report.dirty_queue_size);
    println!("  changed: {}", report.public_counts.changed);
    println!("  removed: {}", report.public_counts.removed);
    println!("  metadata: {}", report.public_counts.metadata);
    if let Some(last_apply) = &report.last_apply_success_at {
        println!("  lastApplySuccessAt: {last_apply}");
    }
    if let Some(last_apply_failure) = &report.last_apply_failure_at {
        println!("  lastApplyFailureAt: {last_apply_failure}");
    }
    if let Some(last_apply_error) = &report.last_apply_error {
        println!("  lastApplyError: {last_apply_error}");
    }
    if let Some(last_daemon) = &report.last_daemon_success_at {
        println!("  lastDaemonSuccessAt: {last_daemon}");
    }
    if let Some(last_daemon_failure) = &report.last_daemon_failure_at {
        println!("  lastDaemonFailureAt: {last_daemon_failure}");
    }
    if let Some(last_daemon_error) = &report.last_daemon_error {
        println!("  lastDaemonError: {last_daemon_error}");
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::{RuntimeStatus, build_with_runtime};
    use crate::{
        baseline::{GenerateOptions, generate},
        capabilities, internal, layout,
        paths::Paths,
        readiness,
    };
    use std::{fs, os::unix::fs::symlink};

    #[test]
    fn status_reports_runtime_diagnostics_errors_and_cached_counts() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.paths.changed_dir.join("etc")).unwrap();
        fs::write(fixture.paths.changed_dir.join("etc/hello"), "changed").unwrap();
        readiness::write_ready(&fixture.paths, "daemon").unwrap();
        let db = internal::StateDb::open_or_rebuild(&fixture.paths).unwrap();
        db.record_phase_failure("apply", "boom").unwrap();
        let capabilities = capabilities::probe(&fixture.paths.data_dir).unwrap();
        db.record_diagnostic(
            "capabilities",
            &serde_json::to_string(&capabilities).unwrap(),
        )
        .unwrap();
        db.rebuild_public_index(&fixture.paths).unwrap();

        let report = build_with_runtime(
            &fixture.paths,
            &db,
            RuntimeStatus {
                dirty_queue_size: 7,
                watch_status: Some("degraded".into()),
                audit_status: Some("running".into()),
            },
        )
        .unwrap();

        assert!(report.ready);
        assert_eq!(report.phase, "ready");
        assert_eq!(report.last_error.as_deref(), Some("boom"));
        assert!(report.last_apply_failure_at.is_some());
        assert_eq!(report.last_apply_error.as_deref(), Some("boom"));
        assert_eq!(report.watch_status, "degraded");
        assert_eq!(report.audit_status, "running");
        assert_eq!(report.dirty_queue_size, 7);
        assert_eq!(report.public_counts.changed, 2);
        assert!(report.baseline_valid);
        assert_eq!(report.capabilities, Some(capabilities));
    }

    #[test]
    fn status_does_not_treat_ready_symlink_as_ready() {
        let fixture = Fixture::new();
        let outside = fixture._temp.path().join("outside-ready");
        fs::write(&outside, "ready").unwrap();
        symlink(&outside, &fixture.paths.ready_file).unwrap();
        let db = internal::StateDb::open_or_rebuild(&fixture.paths).unwrap();

        let report = build_with_runtime(&fixture.paths, &db, RuntimeStatus::default()).unwrap();

        assert!(!report.ready);
        assert_eq!(report.phase, "starting");
    }

    struct Fixture {
        _temp: tempfile::TempDir,
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
            fs::create_dir_all(root.join("opt/persistd")).unwrap();
            fs::create_dir_all(root.join("etc")).unwrap();
            fs::write(root.join("etc/hello"), "hello").unwrap();
            generate(&GenerateOptions {
                root,
                output: paths.baseline_db.clone(),
            })
            .unwrap();
            layout::ensure(&paths).unwrap();
            Self { _temp: temp, paths }
        }
    }
}
