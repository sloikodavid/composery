use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::{internal::StateDb, paths::Paths};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusReport {
    pub ready: bool,
    pub phase: String,
    pub last_apply_success_at: Option<String>,
    pub last_daemon_success_at: Option<String>,
    pub watch_status: String,
    pub audit_status: String,
    pub last_error: Option<String>,
    pub baseline_present: bool,
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
    Ok(StatusReport {
        ready: paths.ready_file.exists(),
        phase: if paths.ready_file.exists() {
            "ready".into()
        } else {
            "starting".into()
        },
        last_apply_success_at: db.meta_value("last_apply_success_at")?,
        last_daemon_success_at: db.meta_value("last_daemon_success_at")?,
        watch_status: "running".into(),
        audit_status: "running".into(),
        last_error: None,
        baseline_present: paths.baseline_db.exists(),
        dirty_queue_size: 0,
        public_counts: PublicCounts {
            changed: db.public_count("changed")?,
            removed: db.public_count("removed")?,
            metadata: db.metadata_record_count()?,
        },
    })
}

pub fn print_human(report: &StatusReport) {
    println!("persistd status:");
    println!("  ready: {}", report.ready);
    println!("  phase: {}", report.phase);
    println!("  baseline: {}", report.baseline_present);
    println!("  watch: {}", report.watch_status);
    println!("  audit: {}", report.audit_status);
    println!("  dirtyQueueSize: {}", report.dirty_queue_size);
    println!("  changed: {}", report.public_counts.changed);
    println!("  removed: {}", report.public_counts.removed);
    println!("  metadata: {}", report.public_counts.metadata);
    if let Some(last_apply) = &report.last_apply_success_at {
        println!("  lastApplySuccessAt: {last_apply}");
    }
    if let Some(last_daemon) = &report.last_daemon_success_at {
        println!("  lastDaemonSuccessAt: {last_daemon}");
    }
}
