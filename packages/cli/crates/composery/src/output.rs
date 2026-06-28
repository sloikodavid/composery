use anyhow::Result;
use serde::Serialize;

pub fn render<T: Serialize>(report: &T, json: bool, human: impl FnOnce(&T)) -> Result<()> {
    if json {
        serde_json::to_writer_pretty(std::io::stdout(), report)?;
        println!();
    } else {
        human(report);
    }
    Ok(())
}
