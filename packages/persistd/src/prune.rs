use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::{internal::StateDb, paths::Paths};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneReport {
    pub removed: Vec<String>,
    pub skipped: Vec<String>,
}

pub fn run(paths: &Paths, db: &StateDb) -> Result<PruneReport> {
    db.rebuild_public_index(paths)?;
    Ok(PruneReport {
        removed: Vec::new(),
        skipped: vec!["destructive prune classes are not enabled yet".into()],
    })
}

pub fn print_human(report: &PruneReport) {
    println!("persistd prune:");
    if report.removed.is_empty() {
        println!("  removed: none");
    } else {
        for removed in &report.removed {
            println!("  removed: {removed}");
        }
    }
    for skipped in &report.skipped {
        println!("  skipped: {skipped}");
    }
}
