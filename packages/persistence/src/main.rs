use anyhow::Result;
use clap::Parser;

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "persistence=info".into()),
        )
        .with_ansi(false)
        .with_writer(std::io::stdout)
        .init();

    persistence::cli::run(persistence::cli::Args::parse())
}
