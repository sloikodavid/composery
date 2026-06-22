use anyhow::Result;
use clap::Parser;

use crate::commands;

/// The Composery control CLI.
///
/// The command tree mirrors the module tree: each top-level command group is a
/// module under `commands`, and global flags live here so every subcommand
/// shares them.
#[derive(Debug, Parser)]
#[command(
    name = "composery",
    version,
    about = "Composery control CLI",
    subcommand_required = true,
    arg_required_else_help = true,
    propagate_version = true
)]
pub struct Cli {
    /// Emit machine-readable JSON instead of a human summary.
    #[arg(long, global = true)]
    pub json: bool,
    #[command(subcommand)]
    command: commands::Command,
}

pub fn run(cli: Cli) -> Result<()> {
    commands::run(cli.command, cli.json)
}

/// Initialize logging: diagnostics go to stderr so stdout stays clean for
/// machine-readable output (e.g. `composery persistence status --json | jq`).
pub fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "composery=info,persistence=info".into()),
        )
        .with_ansi(false)
        .with_writer(std::io::stderr)
        .init();
}

#[cfg(test)]
mod tests {
    use clap::CommandFactory as _;

    #[test]
    fn verify_cli() {
        super::Cli::command().debug_assert();
    }
}
