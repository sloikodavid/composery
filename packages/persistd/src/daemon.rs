use anyhow::{Context, Result};

#[cfg(unix)]
use std::{
    io::{BufRead, BufReader, Write},
    os::unix::net::{UnixListener, UnixStream},
    path::PathBuf,
    thread,
    time::Duration,
};

use crate::{config, control, doctor, internal, layout, paths::Paths, prune, readiness, status};

#[cfg(unix)]
use crate::{audit, watch};

#[cfg(unix)]
pub fn run(paths: &Paths) -> Result<()> {
    layout::remove_ready(paths)?;
    layout::ensure(paths)?;
    let _lock = internal::WriterLock::acquire(paths)?;
    remove_stale_control_socket(paths)?;
    let db = internal::StateDb::open_or_rebuild(paths)?;
    let config = config::load_or_create(&paths.config_file)?;

    #[cfg(unix)]
    let _watcher = watch::Watcher::start(PathBuf::from("/"), paths.clone(), config.clone())?;
    #[cfg(unix)]
    let _auditor = audit::Auditor::start(PathBuf::from("/"), paths.clone(), config)?;

    db.record_phase_success("daemon")?;

    let listener = UnixListener::bind(&paths.control_socket)
        .with_context(|| format!("bind {}", paths.control_socket.display()))?;
    listener
        .set_nonblocking(true)
        .context("set control socket nonblocking")?;

    readiness::write_ready(paths, "daemon")?;
    tracing::info!("persistd daemon is ready");

    loop {
        match listener.accept() {
            Ok((stream, _addr)) => {
                if let Err(error) = handle_control_stream(stream, paths, &db) {
                    tracing::warn!(error = %error, "control request failed");
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error).context("accept control connection"),
        }
    }
}

#[cfg(not(unix))]
pub fn run(_paths: &Paths) -> Result<()> {
    anyhow::bail!("persistd daemon is only supported on Unix");
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
fn handle_control_stream(
    mut stream: UnixStream,
    paths: &Paths,
    db: &internal::StateDb,
) -> Result<()> {
    let mut line = String::new();
    BufReader::new(stream.try_clone().context("clone control stream")?)
        .read_line(&mut line)
        .context("read control request")?;

    let response = match serde_json::from_str::<control::Request>(&line) {
        Ok(request) if request.version == 1 => handle_control_request(request.command, paths, db)
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
    paths: &Paths,
    db: &internal::StateDb,
) -> Result<control::Response> {
    match command {
        control::Command::Status => control::Response::ok(&status::build(paths, db)?),
        control::Command::Doctor => control::Response::ok(&doctor::run(paths, db)?),
        control::Command::Prune => control::Response::ok(&prune::run(paths, db)?),
    }
}

#[cfg(unix)]
#[cfg(test)]
mod tests {
    use super::handle_control_stream;
    use crate::{control, internal::StateDb, layout, paths::Paths};
    use std::{
        io::{BufRead, BufReader, Write},
        os::unix::net::UnixStream,
        thread,
    };

    #[test]
    fn status_doctor_and_prune_requests_are_served_over_control_stream() {
        let temp = tempfile::tempdir().unwrap();
        let paths = Paths::new(
            temp.path().join("opt/persistd"),
            temp.path().join("run/persistd"),
            temp.path().join("data/persistd"),
        );
        layout::ensure(&paths).unwrap();
        let db = StateDb::open_or_rebuild(&paths).unwrap();
        db.record_phase_success("daemon").unwrap();
        let response = request(&paths, control::Command::Status);

        assert!(response.ok);
        assert!(response.payload.unwrap()["publicCounts"]["changed"].is_number());

        let response = request(&paths, control::Command::Doctor);
        assert!(response.ok);
        assert_eq!(response.payload.unwrap()["rebuiltPublicIndex"], true);

        let response = request(&paths, control::Command::Prune);
        assert!(response.ok);
        assert!(
            response.payload.unwrap()["removed"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }

    fn request(paths: &Paths, command: control::Command) -> control::Response {
        let (mut client, server) = UnixStream::pair().unwrap();
        let paths = paths.clone();
        let db = StateDb::open_or_rebuild(&paths).unwrap();
        let server_thread = thread::spawn(move || {
            handle_control_stream(server, &paths, &db).unwrap();
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
}
