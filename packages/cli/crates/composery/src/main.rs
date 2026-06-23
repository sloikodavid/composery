use std::process::ExitCode;

use clap::Parser as _;

use composery::cli::Cli;

fn main() -> ExitCode {
    composery::cli::init_tracing();
    match composery::cli::run(Cli::parse()) {
        Ok(()) => ExitCode::SUCCESS,
        // A closed downstream pipe (`composery ... | head`) is not a failure.
        Err(error) if is_broken_pipe(&error) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("composery: {error:#}");
            ExitCode::FAILURE
        }
    }
}

fn is_broken_pipe(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        cause
            .downcast_ref::<std::io::Error>()
            .is_some_and(|io| io.kind() == std::io::ErrorKind::BrokenPipe)
    })
}
