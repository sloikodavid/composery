use anyhow::Result;
use serde::Serialize;

/// Render a report to stdout: machine-readable JSON when `json` is set,
/// otherwise a human-readable summary. Shared by every command that prints a
/// structured result.
pub fn render<T: Serialize>(report: &T, json: bool, human: impl FnOnce(&T)) -> Result<()> {
    if json {
        serde_json::to_writer_pretty(std::io::stdout(), report)?;
        println!();
    } else {
        human(report);
    }
    Ok(())
}
