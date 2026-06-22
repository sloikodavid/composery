#![cfg(unix)]

use anyhow::{Context, Result};
use inotify::{EventMask, Inotify, WatchDescriptor, WatchMask};
use std::{
    collections::HashMap,
    ffi::OsStr,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread::{self, JoinHandle},
    time::Duration,
};
use walkdir::WalkDir;

use crate::{
    config::Config,
    dirty::DirtySender,
    internal,
    lifecycle::{LifecycleState, LifecycleStatus},
    public::PublicPath,
};

pub struct Watcher {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

struct WatchRuntime {
    root: PathBuf,
    config: Config,
    dirty_tx: DirtySender,
    lifecycle: LifecycleStatus,
    error_log: PathBuf,
    error_tx: mpsc::Sender<String>,
    stop: Arc<AtomicBool>,
    ready: mpsc::Sender<()>,
}

impl Watcher {
    pub fn start(
        root: PathBuf,
        config: Config,
        dirty_tx: DirtySender,
        lifecycle: LifecycleStatus,
        error_log: PathBuf,
        error_tx: mpsc::Sender<String>,
    ) -> Result<Self> {
        lifecycle.set(LifecycleState::Initializing);
        initialize(&root, &config)?;

        let stop = Arc::new(AtomicBool::new(false));
        let thread_stop = Arc::clone(&stop);
        let (ready_tx, ready_rx) = mpsc::channel();
        let thread = thread::Builder::new()
            .name("persistence-watch".into())
            .spawn(move || {
                if let Err(error) = run_loop(WatchRuntime {
                    root,
                    config,
                    dirty_tx,
                    lifecycle: lifecycle.clone(),
                    error_log: error_log.clone(),
                    error_tx: error_tx.clone(),
                    stop: thread_stop,
                    ready: ready_tx,
                }) {
                    lifecycle.set(LifecycleState::Stopped);
                    let summary = format!("{error:#}");
                    let _ = internal::write_error_log(&error_log, &summary);
                    let _ = error_tx.send(summary);
                    tracing::error!(error = %error, "watcher stopped");
                }
            })
            .context("spawn watcher thread")?;
        ready_rx
            .recv_timeout(Duration::from_secs(5))
            .context("watcher did not initialize")?;

        Ok(Self {
            stop,
            thread: Some(thread),
        })
    }
}

impl Drop for Watcher {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn initialize(root: &Path, config: &Config) -> Result<()> {
    ensure_real_root(root)?;
    let mut inotify = Inotify::init().context("initialize inotify")?;
    let mut watches = HashMap::new();
    register_existing_dirs(&mut inotify, &mut watches, root, root, config)?;
    Ok(())
}

fn run_loop(runtime: WatchRuntime) -> Result<()> {
    ensure_real_root(&runtime.root)?;
    let mut inotify = Inotify::init().context("initialize inotify")?;
    let mut watches = HashMap::new();
    register_existing_dirs(
        &mut inotify,
        &mut watches,
        &runtime.root,
        &runtime.root,
        &runtime.config,
    )?;
    let mut buffer = vec![0; 16 * 1024];
    runtime.lifecycle.set(LifecycleState::Running);
    let _ = runtime.ready.send(());

    while !runtime.stop.load(Ordering::Relaxed) {
        let events = match inotify.read_events(&mut buffer) {
            Ok(events) => events,
            Err(error) if error.kind() == ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(25));
                continue;
            }
            Err(error) => return Err(error).context("read inotify events"),
        };

        for event in events {
            if event.mask.contains(EventMask::IGNORED) {
                watches.remove(&event.wd);
                continue;
            }
            if event.mask.contains(EventMask::Q_OVERFLOW) {
                record_queue_overflow(&runtime.lifecycle, &runtime.error_log, &runtime.error_tx);
                continue;
            }
            let Some(base) = watches.get(&event.wd) else {
                continue;
            };
            let candidate = event_path(base, event.name);

            if event.mask.contains(EventMask::ISDIR)
                && event
                    .mask
                    .intersects(EventMask::CREATE | EventMask::MOVED_TO)
                && let Err(error) = register_existing_dirs(
                    &mut inotify,
                    &mut watches,
                    &runtime.root,
                    &candidate,
                    &runtime.config,
                )
            {
                tracing::warn!(error = %error, path = %candidate.display(), "failed to watch new directory");
            }

            match public_path(&runtime.root, &candidate) {
                Ok(public) => {
                    let _ = runtime.dirty_tx.send(public);
                }
                Err(error) => {
                    tracing::warn!(error = %error, path = %candidate.display(), "ignored invalid watch path")
                }
            }
        }
    }

    Ok(())
}

fn ensure_real_root(root: &Path) -> Result<()> {
    let metadata = std::fs::symlink_metadata(root)
        .with_context(|| format!("stat watch root {}", root.display()))?;
    if metadata.file_type().is_dir() {
        Ok(())
    } else {
        anyhow::bail!("watch root must be a real directory: {}", root.display())
    }
}

fn register_existing_dirs(
    inotify: &mut Inotify,
    watches: &mut HashMap<WatchDescriptor, PathBuf>,
    root: &Path,
    start: &Path,
    config: &Config,
) -> Result<()> {
    let mut entries = WalkDir::new(start).follow_links(false).into_iter();
    while let Some(entry) = entries.next() {
        let entry = entry?;
        if !entry.file_type().is_dir() {
            continue;
        }
        if entry.path() != root {
            let public = public_path(root, entry.path())?;
            if crate::public::is_excluded(&public, config) {
                entries.skip_current_dir();
                continue;
            }
        }
        let descriptor = inotify
            .watches()
            .add(
                entry.path(),
                WatchMask::CREATE
                    | WatchMask::MODIFY
                    | WatchMask::DELETE
                    | WatchMask::DELETE_SELF
                    | WatchMask::MOVED_FROM
                    | WatchMask::MOVED_TO
                    | WatchMask::ATTRIB
                    | WatchMask::CLOSE_WRITE,
            )
            .with_context(|| format!("watch {}", entry.path().display()))?;
        watches.insert(descriptor, entry.path().to_path_buf());
    }
    Ok(())
}

fn event_path(base: &Path, name: Option<&OsStr>) -> PathBuf {
    match name {
        Some(name) => base.join(name),
        None => base.to_path_buf(),
    }
}

fn record_queue_overflow(
    lifecycle: &LifecycleStatus,
    error_log: &Path,
    error_tx: &mpsc::Sender<String>,
) {
    let message = "inotify event queue overflowed; rolling audit will recover";
    lifecycle.set(LifecycleState::Degraded);
    let _ = internal::write_error_log(error_log, message);
    let _ = error_tx.send(message.into());
    tracing::warn!("{message}");
}

pub fn public_path(root: &Path, path: &Path) -> Result<PublicPath> {
    let relative = path
        .strip_prefix(root)
        .with_context(|| format!("path escaped root: {}", path.display()))?;
    PublicPath::from_root_relative(relative)
}

#[cfg(test)]
mod tests {
    use super::{Watcher, public_path, record_queue_overflow};
    use crate::{
        config::Config,
        lifecycle::{LifecycleState, LifecycleStatus},
    };
    use std::{
        fs,
        sync::{Arc, atomic::AtomicU64, mpsc},
        thread,
        time::Duration,
    };

    #[test]
    fn watcher_emits_file_change_candidate() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root");
        fs::create_dir_all(root.join("etc")).unwrap();
        fs::write(root.join("etc/hello.txt"), "hello").unwrap();
        let (tx, rx) = mpsc::channel();
        let (error_tx, _error_rx) = mpsc::channel();
        let dirty_tx = crate::dirty::DirtySender::new(tx, Arc::new(AtomicU64::new(0)));
        let lifecycle = LifecycleStatus::new(LifecycleState::Initializing);
        let _watcher = Watcher::start(
            root.clone(),
            Config::default(),
            dirty_tx,
            lifecycle.clone(),
            temp.path().join("watch-error.log"),
            error_tx,
        )
        .unwrap();
        assert_eq!(lifecycle.get(), LifecycleState::Running);

        fs::write(root.join("etc/hello.txt"), "changed").unwrap();

        let public = wait_for_candidate(rx);
        assert_eq!(public.as_bytes(), b"/etc/hello.txt");
    }

    #[test]
    fn public_path_preserves_root_relative_unix_bytes() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("etc")).unwrap();
        assert_eq!(
            public_path(root.path(), &root.path().join("etc/hosts"))
                .unwrap()
                .as_bytes(),
            b"/etc/hosts"
        );
    }

    #[test]
    fn watcher_rejects_non_directory_root_before_ready() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("root-file");
        fs::write(&root, "not a directory").unwrap();
        let (tx, _rx) = mpsc::channel();
        let (error_tx, _error_rx) = mpsc::channel();
        let dirty_tx = crate::dirty::DirtySender::new(tx, Arc::new(AtomicU64::new(0)));
        let lifecycle = LifecycleStatus::new(LifecycleState::Initializing);

        let error = match Watcher::start(
            root,
            Config::default(),
            dirty_tx,
            lifecycle,
            temp.path().join("watch-error.log"),
            error_tx,
        ) {
            Ok(_) => panic!("watcher accepted non-directory root"),
            Err(error) => error.to_string(),
        };

        assert!(error.contains("real directory"));
    }

    #[test]
    fn watcher_overflow_records_degraded_status_and_error_log() {
        let temp = tempfile::tempdir().unwrap();
        let lifecycle = LifecycleStatus::new(LifecycleState::Running);
        let error_log = temp.path().join("watch-error.log");
        let (error_tx, error_rx) = mpsc::channel();

        record_queue_overflow(&lifecycle, &error_log, &error_tx);

        assert_eq!(lifecycle.get(), LifecycleState::Degraded);
        assert!(
            fs::read_to_string(error_log)
                .unwrap()
                .contains("inotify event queue overflowed")
        );
        assert!(
            error_rx
                .recv_timeout(Duration::from_secs(1))
                .unwrap()
                .contains("inotify event queue overflowed")
        );
    }

    fn wait_for_candidate(
        rx: mpsc::Receiver<crate::public::PublicPath>,
    ) -> crate::public::PublicPath {
        for _ in 0..50 {
            if let Ok(path) = rx.recv_timeout(Duration::from_millis(100)) {
                return path;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("candidate was not emitted");
    }
}
