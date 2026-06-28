use anyhow::Result;
use clap::Subcommand;

use persistence::paths::Paths;
use persistence::{boot, control, daemon, doctor, prune, status};

#[cfg(unix)]
use std::path::PathBuf;

use crate::output;

#[derive(Debug, Subcommand)]
pub enum PersistenceCommand {
    /// Apply persisted public truth to the live filesystem during boot.
    Apply,
    /// Run the long-lived persistence daemon.
    Daemon,
    /// Print operational daemon status.
    Status,
    /// Ask the daemon to validate and safely repair persistence state.
    Doctor,
    /// Ask the daemon to remove stale public persistence data.
    Prune,
    /// Internal image-build command. Not part of the runtime command surface.
    #[cfg(unix)]
    #[command(name = "__generate-baseline", hide = true)]
    GenerateBaseline {
        #[arg(long, default_value = "/")]
        root: PathBuf,
        #[arg(long, default_value = "/opt/persistence/baseline.sqlite")]
        output: PathBuf,
    },
}

pub fn run(command: PersistenceCommand, json: bool) -> Result<()> {
    let paths = Paths::default();
    match command {
        PersistenceCommand::Apply => boot::apply(&paths),
        PersistenceCommand::Daemon => daemon::run(&paths),
        PersistenceCommand::Status => output::render(
            &control::query::<status::StatusReport>(&paths, control::Command::Status)?,
            json,
            status::print_human,
        ),
        PersistenceCommand::Doctor => output::render(
            &control::query::<doctor::DoctorReport>(&paths, control::Command::Doctor)?,
            json,
            doctor::print_human,
        ),
        PersistenceCommand::Prune => output::render(
            &control::query::<prune::PruneReport>(&paths, control::Command::Prune)?,
            json,
            prune::print_human,
        ),
        #[cfg(unix)]
        PersistenceCommand::GenerateBaseline { root, output } => {
            persistence::baseline::generate(&persistence::baseline::GenerateOptions {
                root,
                output,
            })
        }
    }
}
