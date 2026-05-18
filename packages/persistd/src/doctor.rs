use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::{internal::StateDb, metadata, paths::Paths};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctorReport {
    pub metadata_records: usize,
    pub rebuilt_public_index: bool,
    pub baseline_present: bool,
    pub findings: Vec<String>,
}

pub fn run(paths: &Paths, db: &StateDb) -> Result<DoctorReport> {
    let metadata_records = metadata::compact(&paths.metadata_file)?.len();
    db.rebuild_public_index(paths)?;

    let mut findings = Vec::new();
    let baseline_present = paths.baseline_db.exists();
    if !baseline_present {
        findings.push(format!("missing baseline: {}", paths.baseline_db.display()));
    }

    Ok(DoctorReport {
        metadata_records,
        rebuilt_public_index: true,
        baseline_present,
        findings,
    })
}

pub fn print_human(report: &DoctorReport) {
    println!("persistd doctor:");
    println!("  metadataRecords: {}", report.metadata_records);
    println!("  rebuiltPublicIndex: {}", report.rebuilt_public_index);
    println!("  baselinePresent: {}", report.baseline_present);
    if report.findings.is_empty() {
        println!("  findings: none");
    } else {
        for finding in &report.findings {
            println!("  finding: {finding}");
        }
    }
}
