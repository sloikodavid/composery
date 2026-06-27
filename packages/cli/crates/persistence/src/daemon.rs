use anyhow::{Context, Result};

#[cfg(unix)]
use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::{UnixListener, UnixStream},
    path::PathBuf,
    sync::{Arc, atomic::AtomicU64, mpsc},
    thread,
    time::Duration,
};

use crate::{config, control, doctor, internal, layout, paths::Paths, prune, readiness, status};

#[cfg(unix)]
use crate::{
    audit,
    baseline::BaselineDb,
    capabilities, dirty,
    lifecycle::{LifecycleState, LifecycleStatus},
    public::PublicPath,
    rootfs, update, watch,
};

#[cfg(unix)]
enum WriterCommand {
    Status(mpsc::Sender<Result<status::StatusReport, String>>),
    Doctor(mpsc::Sender<Result<doctor::DoctorReport, String>>),
    Prune(mpsc::Sender<Result<prune::PruneReport, String>>),
}

#[cfg(unix)]
struct WriterRuntime {
    root: PathBuf,
    paths: Paths,
    config: config::Config,
    baseline: BaselineDb,
    db: internal::StateDb,
    dirty_tx: dirty::DirtySender,
    dirty_pending: Arc<AtomicU64>,
    watch_status: LifecycleStatus,
    audit_status: LifecycleStatus,
}

#[cfg(unix)]
pub fn run(paths: &Paths) -> Result<()> {
    run_inner(paths, PathBuf::from("/"), None)
}

#[cfg(unix)]
fn run_inner(paths: &Paths, root: PathBuf, mut stop_rx: Option<mpsc::Receiver<()>>) -> Result<()> {
    layout::ensure(paths)?;
    let _lock = internal::WriterLock::acquire(paths)?;
    layout::remove_ready(paths)?;
    remove_stale_control_socket(paths)?;

    let db = internal::StateDb::open_or_rebuild(paths)?;
    let config = config::load_or_create(&paths.config_file)?;
    let baseline = BaselineDb::open(&paths.baseline_db)
        .with_context(|| format!("daemon requires baseline {}", paths.baseline_db.display()))?;
    let capability_report = capabilities::probe(&paths.data_dir)?;
    db.record_diagnostic("capabilities", &serde_json::to_string(&capability_report)?)?;

    let baseline_records = baseline.all_records()?;
    let (writer_tx, writer_rx) = mpsc::channel();
    let (dirty_tx, dirty_rx) = mpsc::channel();
    let (watch_error_tx, watch_error_rx) = mpsc::channel();
    let dirty_pending = Arc::new(AtomicU64::new(0));
    let dirty_sender = dirty::DirtySender::new(dirty_tx, Arc::clone(&dirty_pending));
    let watch_status = LifecycleStatus::new(LifecycleState::Initializing);
    let audit_status = LifecycleStatus::new(LifecycleState::Initializing);

    let _watcher = match watch::Watcher::start(
        root.clone(),
        config.clone(),
        dirty_sender.clone(),
        watch_status.clone(),
        paths.watch_error_log.clone(),
        watch_error_tx,
    ) {
        Ok(watcher) => watcher,
        Err(error) => {
            let summary = format!("{error:#}");
            let _ = db.record_phase_failure("watch", &summary);
            let _ = internal::write_error_log(&paths.watch_error_log, &summary);
            return Err(error).context("initialize watcher");
        }
    };
    let _auditor = match audit::Auditor::start(
        root.clone(),
        baseline_records,
        config.clone(),
        dirty_sender.clone(),
        audit_status.clone(),
    ) {
        Ok(auditor) => auditor,
        Err(error) => {
            let _ = db.record_phase_failure("audit", &format!("{error:#}"));
            return Err(error).context("initialize auditor");
        }
    };

    let writer_dirty_sender = dirty_sender.clone();
    let writer_root = root;
    let writer_paths = paths.clone();
    let writer_config = config;
    let writer_watch_status = watch_status.clone();
    let writer_audit_status = audit_status.clone();
    let writer = thread::Builder::new()
        .name("persistence-writer".into())
        .spawn(move || {
            writer_loop(
                WriterRuntime {
                    root: writer_root,
                    paths: writer_paths,
                    config: writer_config,
                    baseline,
                    db,
                    dirty_tx: writer_dirty_sender,
                    dirty_pending: Arc::clone(&dirty_pending),
                    watch_status: writer_watch_status,
                    audit_status: writer_audit_status,
                },
                writer_rx,
                dirty_rx,
                watch_error_rx,
            );
        })
        .context("spawn writer thread")?;

    request_unit(&writer_tx, WriterCommand::Status).context("verify writer status")?;
    let listener = UnixListener::bind(&paths.control_socket)
        .with_context(|| format!("bind {}", paths.control_socket.display()))?;
    listener
        .set_nonblocking(true)
        .context("set control socket nonblocking")?;

    let db = internal::StateDb::open_or_rebuild(paths)?;
    db.record_phase_success("daemon")?;
    db.record_diagnostic("watch_status", &watch_status.text())?;
    db.record_diagnostic("audit_status", &audit_status.text())?;
    db.record_diagnostic("capabilities", &serde_json::to_string(&capability_report)?)?;
    readiness::write_ready(paths, "daemon")?;
    let _runtime_files = RuntimeFilesGuard { paths };
    tracing::info!("persistence daemon is ready");

    loop {
        if should_stop(&mut stop_rx) {
            break;
        }
        match listener.accept() {
            Ok((stream, _addr)) => {
                if let Err(error) = handle_control_stream(stream, &writer_tx) {
                    tracing::warn!(error = %error, "control request failed");
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if writer.is_finished() {
                    anyhow::bail!("persistence writer stopped");
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error).context("accept control connection"),
        }
    }

    drop(listener);
    drop(_watcher);
    drop(_auditor);
    drop(writer_tx);
    writer
        .join()
        .map_err(|_| anyhow::anyhow!("persistence writer thread panicked"))?;

    Ok(())
}

#[cfg(not(unix))]
pub fn run(_paths: &Paths) -> Result<()> {
    anyhow::bail!("persistence daemon is only supported on Unix");
}

#[cfg(unix)]
fn writer_loop(
    runtime: WriterRuntime,
    command_rx: mpsc::Receiver<WriterCommand>,
    dirty_rx: mpsc::Receiver<PublicPath>,
    watch_error_rx: mpsc::Receiver<String>,
) {
    let update_context = update::UpdateContext {
        root: &runtime.root,
        paths: &runtime.paths,
        config: &runtime.config,
        baseline: &runtime.baseline,
    };

    loop {
        let mut public_index_dirty = false;
        record_watch_errors(&runtime, &watch_error_rx);
        let mut retry_paths = Vec::new();
        for _ in 0..256 {
            let Ok(public_path) = dirty_rx.try_recv() else {
                break;
            };
            match update::update_public_path(&update_context, &public_path) {
                Ok(update::UpdateOutcome::Ignored) => {}
                Ok(_) => {
                    public_index_dirty = true;
                }
                Err(error) => {
                    if rootfs::is_copy_unstable_error(&error) {
                        tracing::warn!(error = %error, path = %public_path, "dirty path changed during copy; requeueing");
                        retry_paths.push(public_path.clone());
                    } else {
                        tracing::warn!(error = %error, path = %public_path, "dirty path update failed");
                        let _ = runtime
                            .db
                            .record_phase_failure("update", &format!("{error:#}"));
                    }
                }
            }
            dirty::mark_processed(&runtime.dirty_pending);
        }
        if !retry_paths.is_empty() {
            thread::sleep(Duration::from_millis(50));
            for public_path in retry_paths {
                let _ = runtime.dirty_tx.send(public_path);
            }
        }
        if public_index_dirty {
            let _ = runtime.db.rebuild_public_index(&runtime.paths);
        }

        match command_rx.recv_timeout(Duration::from_millis(100)) {
            Ok(command) => {
                record_watch_errors(&runtime, &watch_error_rx);
                match command {
                    WriterCommand::Status(response) => {
                        let dirty_queue_size = dirty::pending_count(&runtime.dirty_pending);
                        let _ = response.send(
                            status::build_with_runtime(
                                &runtime.paths,
                                &runtime.db,
                                status::RuntimeStatus {
                                    dirty_queue_size,
                                    watch_status: Some(runtime.watch_status.text()),
                                    audit_status: Some(runtime.audit_status.text()),
                                },
                            )
                            .map_err(|error| format!("{error:#}")),
                        );
                    }
                    WriterCommand::Doctor(response) => {
                        let _ = response.send(
                            doctor::run(&runtime.paths, &runtime.db)
                                .map_err(|error| format!("{error:#}")),
                        );
                    }
                    WriterCommand::Prune(response) => {
                        let _ = response.send(
                            prune::run(
                                &runtime.root,
                                &runtime.paths,
                                &runtime.config,
                                &runtime.baseline,
                                &runtime.db,
                            )
                            .map_err(|error| format!("{error:#}")),
                        );
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

#[cfg(unix)]
fn record_watch_errors(runtime: &WriterRuntime, watch_error_rx: &mpsc::Receiver<String>) {
    for error in watch_error_rx.try_iter() {
        let _ = runtime.db.record_phase_failure("watch", &error);
    }
}

#[cfg(unix)]
fn remove_stale_control_socket(paths: &Paths) -> Result<()> {
    match std::fs::remove_file(&paths.control_socket) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error).with_context(|| {
            format!(
                "remove stale control socket {}",
                paths.control_socket.display()
            )
        }),
    }
}

#[cfg(unix)]
struct RuntimeFilesGuard<'a> {
    paths: &'a Paths,
}

#[cfg(unix)]
impl Drop for RuntimeFilesGuard<'_> {
    fn drop(&mut self) {
        let _ = layout::remove_ready(self.paths);
        let _ = std::fs::remove_file(&self.paths.control_socket);
    }
}

#[cfg(unix)]
fn should_stop(stop_rx: &mut Option<mpsc::Receiver<()>>) -> bool {
    let Some(stop_rx) = stop_rx else {
        return false;
    };
    match stop_rx.try_recv() {
        Ok(()) | Err(mpsc::TryRecvError::Disconnected) => true,
        Err(mpsc::TryRecvError::Empty) => false,
    }
}

#[cfg(unix)]
fn handle_control_stream(
    mut stream: UnixStream,
    writer_tx: &mpsc::Sender<WriterCommand>,
) -> Result<()> {
    let mut line = String::new();
    BufReader::new(stream.try_clone().context("clone control stream")?)
        .read_line(&mut line)
        .context("read control request")?;

    let response = match serde_json::from_str::<control::Request>(&line) {
        Ok(request) if request.version == 1 => handle_control_request(request.command, writer_tx)
            .unwrap_or_else(control::Response::error),
        Ok(request) => control::Response::error(format!(
            "unsupported control protocol version {}",
            request.version
        )),
        Err(error) => control::Response::error(format!("invalid control request: {error}")),
    };

    serde_json::to_writer(&mut stream, &response).context("write control response")?;
    stream.write_all(b"\n").context("finish control response")?;
    Ok(())
}

#[cfg(unix)]
fn handle_control_request(
    command: control::Command,
    writer_tx: &mpsc::Sender<WriterCommand>,
) -> Result<control::Response> {
    match command {
        control::Command::Status => {
            let report = request_unit(writer_tx, WriterCommand::Status)?;
            control::Response::ok(&report)
        }
        control::Command::Doctor => {
            let report = request_unit(writer_tx, WriterCommand::Doctor)?;
            control::Response::ok(&report)
        }
        control::Command::Prune => {
            let report = request_unit(writer_tx, WriterCommand::Prune)?;
            control::Response::ok(&report)
        }
    }
}

#[cfg(unix)]
fn request_unit<T: Send + 'static>(
    writer_tx: &mpsc::Sender<WriterCommand>,
    build: impl FnOnce(mpsc::Sender<Result<T, String>>) -> WriterCommand,
) -> Result<T> {
    request_unit_with_timeout(writer_tx, build, Duration::from_secs(10))
}

#[cfg(unix)]
fn request_unit_with_timeout<T: Send + 'static>(
    writer_tx: &mpsc::Sender<WriterCommand>,
    build: impl FnOnce(mpsc::Sender<Result<T, String>>) -> WriterCommand,
    timeout: Duration,
) -> Result<T> {
    let (response_tx, response_rx) = mpsc::channel();
    writer_tx
        .send(build(response_tx))
        .context("send writer command")?;
    response_rx
        .recv_timeout(timeout)
        .context("writer command timed out")?
        .map_err(anyhow::Error::msg)
}

#[cfg(unix)]
#[cfg(test)]
mod tests {
    use super::{WriterCommand, WriterRuntime, handle_control_stream, run_inner, writer_loop};
    use crate::{
        baseline::{BaselineDb, GenerateOptions, generate},
        config::Config,
        control,
        dirty::DirtySender,
        internal::StateDb,
        layout,
        lifecycle::{LifecycleState, LifecycleStatus},
        paths::Paths,
        public::PublicPath,
        status::StatusReport,
    };
    use std::{
        fs,
        io::{BufRead, BufReader, Write},
        os::unix::net::UnixStream,
        sync::{Arc, atomic::AtomicU64, mpsc},
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn status_doctor_and_prune_requests_are_served_through_writer() {
        let fixture = Fixture::new();
        let (writer_tx, writer_rx) = mpsc::channel();
        let (dirty_tx, dirty_rx) = mpsc::channel();
        let (watch_error_tx, watch_error_rx) = mpsc::channel();
        let dirty_pending = Arc::new(AtomicU64::new(0));
        let dirty_sender = DirtySender::new(dirty_tx, Arc::clone(&dirty_pending));
        let root = fixture.root.clone();
        let paths = fixture.paths.clone();
        let baseline = BaselineDb::open(&paths.baseline_db).unwrap();
        let db = StateDb::open_or_rebuild(&paths).unwrap();
        let writer_thread = thread::spawn(move || {
            writer_loop(
                WriterRuntime {
                    root,
                    paths,
                    config: Config::default(),
                    baseline,
                    db,
                    dirty_tx: dirty_sender,
                    dirty_pending,
                    watch_status: LifecycleStatus::new(LifecycleState::Running),
                    audit_status: LifecycleStatus::new(LifecycleState::Running),
                },
                writer_rx,
                dirty_rx,
                watch_error_rx,
            );
        });

        watch_error_tx
            .send("inotify event queue overflowed; rolling audit will recover".into())
            .unwrap();
        let response = request(&writer_tx, control::Command::Status);
        assert!(response.ok);
        let payload = response.payload.unwrap();
        assert!(payload["publicCounts"]["changed"].is_number());
        assert_eq!(
            payload["lastError"],
            "inotify event queue overflowed; rolling audit will recover"
        );
        let db = StateDb::open_or_rebuild(&fixture.paths).unwrap();
        assert_eq!(
            db.meta_value("last_watch_error").unwrap().as_deref(),
            Some("inotify event queue overflowed; rolling audit will recover")
        );

        let response = request(&writer_tx, control::Command::Doctor);
        assert!(response.ok);
        assert_eq!(response.payload.unwrap()["rebuiltPublicIndex"], true);

        let response = request(&writer_tx, control::Command::Prune);
        assert!(response.ok);

        drop(writer_tx);
        writer_thread.join().unwrap();
    }

    #[test]
    fn writer_status_reports_shared_worker_lifecycle_states() {
        let fixture = Fixture::new();
        let (writer_tx, writer_rx) = mpsc::channel();
        let (dirty_tx, dirty_rx) = mpsc::channel();
        let (_watch_error_tx, watch_error_rx) = mpsc::channel();
        let dirty_pending = Arc::new(AtomicU64::new(0));
        let dirty_sender = DirtySender::new(dirty_tx, Arc::clone(&dirty_pending));
        let watch_status = LifecycleStatus::new(LifecycleState::Initializing);
        let audit_status = LifecycleStatus::new(LifecycleState::Initializing);
        let root = fixture.root.clone();
        let paths = fixture.paths.clone();
        let baseline = BaselineDb::open(&paths.baseline_db).unwrap();
        let db = StateDb::open_or_rebuild(&paths).unwrap();
        let writer_watch_status = watch_status.clone();
        let writer_audit_status = audit_status.clone();
        let writer_thread = thread::spawn(move || {
            writer_loop(
                WriterRuntime {
                    root,
                    paths,
                    config: Config::default(),
                    baseline,
                    db,
                    dirty_tx: dirty_sender,
                    dirty_pending,
                    watch_status: writer_watch_status,
                    audit_status: writer_audit_status,
                },
                writer_rx,
                dirty_rx,
                watch_error_rx,
            );
        });

        for state in [
            LifecycleState::Initializing,
            LifecycleState::Running,
            LifecycleState::Degraded,
            LifecycleState::Stopped,
        ] {
            watch_status.set(state);
            audit_status.set(state);

            let response = request(&writer_tx, control::Command::Status);
            assert!(response.ok);
            let payload = response.payload.unwrap();
            assert_eq!(payload["watchStatus"], state.as_str());
            assert_eq!(payload["auditStatus"], state.as_str());
        }

        drop(writer_tx);
        writer_thread.join().unwrap();
    }

    #[test]
    fn daemon_writes_ready_after_workers_start_and_serves_socket() {
        let fixture = Fixture::new();
        fs::write(&fixture.paths.ready_file, "stale").unwrap();
        let (stop_tx, stop_rx) = mpsc::channel();
        let root = fixture.root.clone();
        let paths = fixture.paths.clone();
        let daemon = thread::spawn(move || run_inner(&paths, root, Some(stop_rx)));

        wait_for(
            || {
                fs::read_to_string(&fixture.paths.ready_file)
                    .is_ok_and(|ready| ready.contains("\"phase\": \"daemon\""))
            },
            "daemon ready file",
        );

        let ready = fs::read_to_string(&fixture.paths.ready_file).unwrap();
        assert!(ready.contains("\"ready\": true"));
        assert!(ready.contains("\"phase\": \"daemon\""));
        assert_ne!(ready, "stale");

        let report: StatusReport =
            control::request(&fixture.paths.control_socket, control::Command::Status).unwrap();
        assert!(report.ready);
        assert_eq!(report.watch_status, "running");
        assert_eq!(report.audit_status, "running");
        assert!(report.last_daemon_success_at.is_some());

        fs::write(fixture.root.join("etc/hello"), "changed").unwrap();
        wait_for(
            || {
                fs::read_to_string(fixture.paths.changed_dir.join("etc/hello"))
                    .is_ok_and(|contents| contents == "changed")
            },
            "persisted changed file",
        );

        let report: StatusReport =
            control::request(&fixture.paths.control_socket, control::Command::Status).unwrap();
        assert!(report.public_counts.changed >= 1);

        stop_tx.send(()).unwrap();
        daemon.join().unwrap().unwrap();
        assert!(!fixture.paths.ready_file.exists());
        assert!(!fixture.paths.control_socket.exists());

        fs::write(fixture.root.join("etc/after-stop"), "not persisted").unwrap();
        thread::sleep(Duration::from_millis(200));
        assert!(!fixture.paths.changed_dir.join("etc/after-stop").exists());
    }

    #[test]
    fn daemon_does_not_remove_live_ready_when_writer_lock_is_held() {
        let fixture = Fixture::new();
        let _lock = crate::internal::WriterLock::acquire(&fixture.paths).unwrap();
        fs::write(&fixture.paths.ready_file, "live").unwrap();

        let error = run_inner(&fixture.paths, fixture.root.clone(), None)
            .unwrap_err()
            .to_string();

        assert!(error.contains("lock"));
        assert_eq!(
            fs::read_to_string(&fixture.paths.ready_file).unwrap(),
            "live"
        );
    }

    #[test]
    fn daemon_does_not_write_ready_when_watcher_initialization_fails() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        let paths = Paths::new(
            temp.path().join("opt/persistence"),
            temp.path().join("run/persistence"),
            temp.path().join("data/persistence"),
        );
        fs::create_dir_all(root.join("etc")).unwrap();
        fs::write(root.join("etc/hello"), "hello").unwrap();
        generate(&GenerateOptions {
            root: root.clone(),
            output: paths.baseline_db.clone(),
        })
        .unwrap();
        layout::ensure(&paths).unwrap();
        fs::write(&paths.ready_file, "stale").unwrap();
        fs::remove_dir_all(&root).unwrap();

        let error = run_inner(&paths, root, None).unwrap_err().to_string();

        assert!(error.contains("initialize watcher"));
        assert!(!paths.ready_file.exists());
        assert!(
            fs::read_to_string(&paths.watch_error_log)
                .unwrap()
                .contains("watch root")
        );
        let db = StateDb::open_or_rebuild(&paths).unwrap();
        assert!(
            db.meta_value("last_watch_error")
                .unwrap()
                .unwrap()
                .contains("watch root")
        );
    }

    #[test]
    fn daemon_restart_does_not_replay_apply() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.paths.changed_dir.join("etc")).unwrap();
        fs::write(fixture.paths.changed_dir.join("etc/hello"), "persisted").unwrap();

        run_daemon_until_ready_then_stop(&fixture);
        assert_eq!(
            fs::read_to_string(fixture.root.join("etc/hello")).unwrap(),
            "hello"
        );

        run_daemon_until_ready_then_stop(&fixture);
        assert_eq!(
            fs::read_to_string(fixture.root.join("etc/hello")).unwrap(),
            "hello"
        );
    }

    #[test]
    fn daemon_restart_audit_recovers_change_missed_while_stopped() {
        let fixture = Fixture::new();
        run_daemon_until_ready_then_stop(&fixture);

        fs::write(fixture.root.join("etc/hello"), "missed while stopped").unwrap();

        let (stop_tx, stop_rx) = mpsc::channel();
        let root = fixture.root.clone();
        let paths = fixture.paths.clone();
        let daemon = thread::spawn(move || run_inner(&paths, root, Some(stop_rx)));

        wait_for(
            || {
                fs::read_to_string(fixture.paths.changed_dir.join("etc/hello"))
                    .is_ok_and(|contents| contents == "missed while stopped")
            },
            "audit recovered missed change",
        );

        stop_tx.send(()).unwrap();
        daemon.join().unwrap().unwrap();
        assert!(!fixture.paths.ready_file.exists());
    }

    #[test]
    fn writer_requeues_unstable_copy_errors() {
        if !std::path::Path::new("/proc/uptime").exists() {
            eprintln!("skipping writer requeue test: /proc/uptime is unavailable");
            return;
        }
        let fixture = Fixture::new();
        let (writer_tx, writer_rx) = mpsc::channel();
        let (dirty_tx, dirty_rx) = mpsc::channel();
        let (_watch_error_tx, watch_error_rx) = mpsc::channel();
        let dirty_pending = Arc::new(AtomicU64::new(0));
        let dirty_sender = DirtySender::new(dirty_tx, Arc::clone(&dirty_pending));
        let root = std::path::PathBuf::from("/");
        let paths = fixture.paths.clone();
        let baseline = BaselineDb::open(&paths.baseline_db).unwrap();
        let db = StateDb::open_or_rebuild(&paths).unwrap();
        let writer_dirty_sender = dirty_sender.clone();
        let writer_pending = Arc::clone(&dirty_pending);
        let writer_thread = thread::spawn(move || {
            writer_loop(
                WriterRuntime {
                    root,
                    paths,
                    config: Config {
                        exclusions: Vec::new(),
                        ..Config::default()
                    },
                    baseline,
                    db,
                    dirty_tx: writer_dirty_sender,
                    dirty_pending: writer_pending,
                    watch_status: LifecycleStatus::new(LifecycleState::Running),
                    audit_status: LifecycleStatus::new(LifecycleState::Running),
                },
                writer_rx,
                dirty_rx,
                watch_error_rx,
            );
        });

        dirty_sender
            .send(PublicPath::parse("/proc/uptime").unwrap())
            .unwrap();
        thread::sleep(Duration::from_millis(300));

        let response = request(&writer_tx, control::Command::Status);
        assert!(response.ok);
        assert!(
            response.payload.unwrap()["dirtyQueueSize"]
                .as_u64()
                .unwrap()
                >= 1
        );
        assert!(!fixture.paths.changed_dir.join("proc/uptime").exists());

        drop(writer_tx);
        writer_thread.join().unwrap();
    }

    fn request(
        writer_tx: &mpsc::Sender<WriterCommand>,
        command: control::Command,
    ) -> control::Response {
        let (mut client, server) = UnixStream::pair().unwrap();
        let writer_tx = writer_tx.clone();
        let server_thread = thread::spawn(move || {
            handle_control_stream(server, &writer_tx).unwrap();
        });

        serde_json::to_writer(
            &mut client,
            &control::Request {
                version: 1,
                command,
            },
        )
        .unwrap();
        client.write_all(b"\n").unwrap();
        let mut line = String::new();
        BufReader::new(client).read_line(&mut line).unwrap();
        server_thread.join().unwrap();

        serde_json::from_str(&line).unwrap()
    }

    fn wait_for(mut predicate: impl FnMut() -> bool, label: &str) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            if predicate() {
                return;
            }
            thread::sleep(Duration::from_millis(25));
        }
        panic!("timed out waiting for {label}");
    }

    fn run_daemon_until_ready_then_stop(fixture: &Fixture) {
        let (stop_tx, stop_rx) = mpsc::channel();
        let root = fixture.root.clone();
        let paths = fixture.paths.clone();
        let daemon = thread::spawn(move || run_inner(&paths, root, Some(stop_rx)));

        wait_for(
            || {
                fs::read_to_string(&fixture.paths.ready_file)
                    .is_ok_and(|ready| ready.contains("\"phase\": \"daemon\""))
            },
            "daemon ready file",
        );

        stop_tx.send(()).unwrap();
        daemon.join().unwrap().unwrap();
        assert!(!fixture.paths.ready_file.exists());
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
                root.join("opt/persistence"),
                temp.path().join("run/persistence"),
                temp.path().join("data/persistence"),
            );
            fs::create_dir_all(root.join("opt/persistence")).unwrap();
            fs::create_dir_all(root.join("etc")).unwrap();
            fs::write(root.join("etc/hello"), "hello").unwrap();
            generate(&GenerateOptions {
                root: root.clone(),
                output: paths.baseline_db.clone(),
            })
            .unwrap();
            layout::ensure(&paths).unwrap();
            Self {
                _temp: temp,
                root,
                paths,
            }
        }
    }
}
