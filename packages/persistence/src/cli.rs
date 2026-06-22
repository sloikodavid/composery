use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};

use std::path::{Path, PathBuf};

#[cfg(unix)]
use crate::apply;
#[cfg(unix)]
use crate::baseline::{GenerateOptions, generate};
#[cfg(unix)]
use crate::capabilities;
use crate::{config, control, daemon, doctor, internal, layout, paths::Paths, prune, status};
#[cfg(unix)]
use std::os::unix::fs::FileTypeExt;

#[derive(Debug, Parser)]
#[command(name = "persistence", about = "Root filesystem persistence daemon")]
pub struct Args {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Apply persisted public truth to the live filesystem during boot.
    Apply,
    /// Run the long-lived persistence daemon.
    Daemon,
    /// Print operational daemon status.
    Status {
        /// Emit machine-readable JSON.
        #[arg(long)]
        json: bool,
    },
    /// Ask the daemon to validate and safely repair persistence state.
    Doctor {
        /// Emit machine-readable JSON.
        #[arg(long)]
        json: bool,
    },
    /// Ask the daemon to remove stale public persistence data.
    Prune {
        /// Emit machine-readable JSON.
        #[arg(long)]
        json: bool,
    },
    /// Internal image-build command. Not part of the runtime command surface.
    #[command(name = "__generate-baseline", hide = true)]
    GenerateBaseline {
        #[arg(long, default_value = "/")]
        root: PathBuf,
        #[arg(long, default_value = "/opt/persistence/baseline.sqlite")]
        output: PathBuf,
    },
}

pub fn run(args: Args) -> Result<()> {
    let paths = Paths::default();
    match args.command {
        Command::Apply => run_apply(&paths),
        Command::Daemon => daemon::run(&paths),
        Command::Status { json } => daemon_command(&paths, "status", json),
        Command::Doctor { json } => daemon_command(&paths, "doctor", json),
        Command::Prune { json } => daemon_command(&paths, "prune", json),
        #[cfg(unix)]
        Command::GenerateBaseline { root, output } => generate(&GenerateOptions { root, output }),
    }
}

fn run_apply(paths: &Paths) -> Result<()> {
    run_apply_with_root(paths, Path::new("/"))
}

fn run_apply_with_root(paths: &Paths, root: &Path) -> Result<()> {
    layout::ensure(paths)?;
    let _lock = internal::WriterLock::acquire(paths)?;
    layout::remove_ready(paths)?;
    let db = internal::StateDb::open_or_rebuild(paths)?;
    match run_apply_inner(paths, root, &db) {
        Ok(()) => {
            db.record_phase_success("apply")?;
            tracing::info!("persistence apply completed");
            Ok(())
        }
        Err(error) => {
            let summary = format!("{error:#}");
            let _ = db.record_phase_failure("apply", &summary);
            let _ = internal::write_error_log(&paths.apply_error_log, &summary);
            Err(error)
        }
    }
}

fn run_apply_inner(paths: &Paths, root: &Path, db: &internal::StateDb) -> Result<()> {
    let config = config::load_or_create(&paths.config_file)?;
    let _baseline = crate::baseline::BaselineDb::open(&paths.baseline_db)
        .with_context(|| format!("apply requires baseline {}", paths.baseline_db.display()))?;
    let capability_report = capabilities::probe(&paths.data_dir)?;
    db.record_diagnostic("capabilities", &serde_json::to_string(&capability_report)?)?;
    crate::metadata::compact(&paths.metadata_file)?;
    #[cfg(unix)]
    apply::apply_public_truth(root, paths, &config)?;
    db.rebuild_public_index(paths)?;
    Ok(())
}

fn daemon_command(paths: &Paths, name: &str, json: bool) -> Result<()> {
    if !control_socket_available(paths) {
        bail!(
            "persistence {name}: daemon is not running; expected control socket at {}",
            paths.control_socket.display()
        );
    }

    match name {
        "status" => {
            let report: status::StatusReport =
                control::request(&paths.control_socket, control::Command::Status)?;
            print_report(&report, json, status::print_human)
        }
        "doctor" => {
            let report: doctor::DoctorReport =
                control::request(&paths.control_socket, control::Command::Doctor)?;
            print_report(&report, json, doctor::print_human)
        }
        "prune" => {
            let report: prune::PruneReport =
                control::request(&paths.control_socket, control::Command::Prune)?;
            print_report(&report, json, prune::print_human)
        }
        _ => bail!("unknown daemon command {name}"),
    }
}

fn control_socket_available(paths: &Paths) -> bool {
    #[cfg(unix)]
    {
        std::fs::symlink_metadata(&paths.control_socket)
            .is_ok_and(|metadata| metadata.file_type().is_socket())
    }

    #[cfg(not(unix))]
    {
        let _ = paths;
        false
    }
}

fn print_report<T: serde::Serialize>(
    report: &T,
    json: bool,
    print_human: impl FnOnce(&T),
) -> Result<()> {
    if json {
        serde_json::to_writer_pretty(std::io::stdout(), report)?;
        println!();
    } else {
        print_human(report);
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use crate::{baseline, internal::StateDb, layout, paths::Paths};
    use std::fs;

    #[test]
    fn apply_fails_without_baseline_and_records_diagnostics() {
        let fixture = Fixture::new();
        fs::create_dir_all(&fixture.paths.run_dir).unwrap();
        fs::write(&fixture.paths.ready_file, "stale").unwrap();

        let error = super::run_apply_with_root(&fixture.paths, &fixture.root)
            .unwrap_err()
            .to_string();

        assert!(error.contains("baseline"));
        assert!(!fixture.paths.ready_file.exists());
        assert!(fixture.paths.apply_error_log.exists());
        let db = StateDb::open_or_rebuild(&fixture.paths).unwrap();
        assert!(
            db.meta_value("last_apply_error")
                .unwrap()
                .unwrap()
                .contains("baseline")
        );
    }

    #[test]
    fn apply_fails_with_corrupt_baseline_and_does_not_write_ready() {
        let fixture = Fixture::new();
        fs::create_dir_all(&fixture.paths.opt_dir).unwrap();
        fs::write(&fixture.paths.baseline_db, "not sqlite").unwrap();

        let error = super::run_apply_with_root(&fixture.paths, &fixture.root)
            .unwrap_err()
            .to_string();

        assert!(error.contains("baseline"));
        assert!(!fixture.paths.ready_file.exists());
        assert!(
            fs::read_to_string(&fixture.paths.apply_error_log)
                .unwrap()
                .contains("baseline")
        );
    }

    #[test]
    fn apply_success_rebuilds_public_index() {
        let fixture = Fixture::new();
        fs::create_dir_all(&fixture.paths.opt_dir).unwrap();
        baseline::generate(&baseline::GenerateOptions {
            root: fixture.root.clone(),
            output: fixture.paths.baseline_db.clone(),
        })
        .unwrap();
        fs::create_dir_all(fixture.paths.changed_dir.join("tmp")).unwrap();
        fs::write(fixture.paths.changed_dir.join("tmp/persisted"), "value").unwrap();

        super::run_apply_with_root(&fixture.paths, &fixture.root).unwrap();

        let db = StateDb::open_or_rebuild(&fixture.paths).unwrap();
        assert_eq!(db.public_count("changed").unwrap(), 2);
        assert!(db.meta_value("last_apply_success_at").unwrap().is_some());
        assert!(!fixture.paths.ready_file.exists());
    }

    #[test]
    fn apply_does_not_remove_live_ready_when_writer_lock_is_held() {
        let fixture = Fixture::new();
        layout::ensure(&fixture.paths).unwrap();
        let _lock = crate::internal::WriterLock::acquire(&fixture.paths).unwrap();
        fs::write(&fixture.paths.ready_file, "live").unwrap();

        let error = super::run_apply_with_root(&fixture.paths, &fixture.root)
            .unwrap_err()
            .to_string();

        assert!(error.contains("lock"));
        assert_eq!(
            fs::read_to_string(&fixture.paths.ready_file).unwrap(),
            "live"
        );
    }

    #[test]
    fn daemon_commands_fail_when_daemon_is_not_running() {
        let fixture = Fixture::new();
        for command in ["status", "doctor", "prune"] {
            let error = super::daemon_command(&fixture.paths, command, true)
                .unwrap_err()
                .to_string();
            assert!(
                error.contains("daemon is not running"),
                "{command}: {error}"
            );
        }
    }

    #[test]
    fn daemon_commands_reject_stale_non_socket_control_path() {
        let fixture = Fixture::new();
        fs::create_dir_all(&fixture.paths.internal_dir).unwrap();
        fs::write(&fixture.paths.control_socket, "not a socket").unwrap();

        let error = super::daemon_command(&fixture.paths, "status", true)
            .unwrap_err()
            .to_string();

        assert!(error.contains("daemon is not running"));
    }

    struct Fixture {
        _temp: tempfile::TempDir,
        root: std::path::PathBuf,
        paths: Paths,
    }

    impl Fixture {
        fn new() -> Self {
            let temp = tempfile::tempdir().unwrap();
            let root = temp.path().join("root");
            let paths = Paths::new(
                temp.path().join("opt/persistence"),
                temp.path().join("run/persistence"),
                temp.path().join("data/persistence"),
            );
            fs::create_dir_all(&root).unwrap();
            Self {
                _temp: temp,
                root,
                paths,
            }
        }
    }
}
