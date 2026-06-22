use anyhow::Result;
use clap::Subcommand;

pub mod persistence;

/// The top-level command tree. Each variant is a command group implemented in
/// its own module; adding a domain (e.g. `api`) is a new module plus one
/// variant here.
#[derive(Debug, Subcommand)]
pub enum Command {
    /// Root filesystem persistence.
    #[command(subcommand)]
    Persistence(persistence::PersistenceCommand),
}

pub fn run(command: Command, json: bool) -> Result<()> {
    match command {
        Command::Persistence(command) => persistence::run(command, json),
    }
}
