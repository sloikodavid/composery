use anyhow::Result;
use clap::Subcommand;

pub mod api;
pub mod persistence;

#[derive(Debug, Subcommand)]
pub enum Command {
    /// Composery automation API (keys, exec surface).
    #[command(subcommand)]
    Api(api::ApiCommand),
    /// Root filesystem persistence.
    #[command(subcommand)]
    Persistence(persistence::PersistenceCommand),
}

pub fn run(command: Command, json: bool) -> Result<()> {
    match command {
        Command::Api(command) => api::run(command, json),
        Command::Persistence(command) => persistence::run(command, json),
    }
}
