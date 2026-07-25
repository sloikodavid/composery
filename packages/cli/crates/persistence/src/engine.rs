//! Persistence engine selection.
//!
//! Two engines satisfy one contract (see `docs/persistence.md`):
//!
//! - **overlay** (preferred where available): the kernel maintains the rootfs
//!   delta via an overlayfs whose upper lives on the `/data` volume. Needs
//!   `CAP_SYS_ADMIN` (privileged containers: Composery Cloud, the systemd
//!   compose templates, VPS/self-hosted-on-your-own-host).
//! - **copy** (universal floor): the userspace watcher/audit/apply daemon. The
//!   only engine that works on managed PaaS that cannot grant privileges. Not
//!   legacy - first-class.
//!
//! Selection mirrors `COMPOSERY_INIT`: `auto` (default) probes by *doing* and
//! picks; `overlay`/`copy` pin explicitly; an unknown value is rejected by the
//! entrypoint with exit 64 before we are called.

use std::path::Path;

use anyhow::{Context, Result, bail};

use crate::{internal::StateDb, layout, paths::Paths};

/// Whether the overlay engine's boot path (mount / pivot / upper-hygiene in
/// `init/overlay.sh`, the daemon stand-down, the hygiene pass) is finished and
/// **proven end to end on a booted container**.
///
/// Still `false`. The code below and in `overlay.rs` is complete and its unit
/// tests pass, but nothing has yet booted a real container onto an overlay root
/// and shown systemd up, files surviving a recreate, an upgrade landing, and
/// DNS working after the pivot. Until that harness runs green
/// (`tests/overlay-engine/`), `auto` never selects overlay and an explicit
/// `overlay` pin fails loudly, so no unproven mount path can reach a real
/// delta - a half-working overlay is far worse than an unfinished one.
///
/// Flipping this to `true` is the last step of that verification, not a
/// prerequisite for it.
///
/// ponytail: single engine gate, deliberately a `const` not a config knob.
pub const OVERLAY_ENGINE_READY: bool = false;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Engine {
    Overlay,
    Copy,
}

impl Engine {
    pub fn as_str(self) -> &'static str {
        match self {
            Engine::Overlay => "overlay",
            Engine::Copy => "copy",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Request {
    Auto,
    Overlay,
    Copy,
}

impl Request {
    /// Parse `COMPOSERY_PERSISTENCE`. Empty/unset is `auto`. An unknown value is
    /// an error: the entrypoint rejects it with exit 64 before calling us, and
    /// we refuse it too rather than silently defaulting.
    pub fn parse(raw: Option<&str>) -> Result<Self> {
        match raw.map(str::trim).unwrap_or("") {
            "" | "auto" => Ok(Request::Auto),
            "overlay" => Ok(Request::Overlay),
            "copy" => Ok(Request::Copy),
            other => bail!(
                "unsupported COMPOSERY_PERSISTENCE {other:?} (expected \"auto\", \"overlay\", or \"copy\")"
            ),
        }
    }

    pub fn from_env() -> Result<Self> {
        Self::parse(std::env::var("COMPOSERY_PERSISTENCE").ok().as_deref())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Selection {
    pub engine: Engine,
    pub reason: String,
}

/// Decide the engine. Pure and probe-injected so the whole matrix is testable
/// without a privileged mount: pass the readiness flag and the probe outcome
/// directly.
///
/// - `copy`: always honoured.
/// - `overlay`: fails loudly when the engine is not ready or the probe fails -
///   never a silent downgrade to copy.
/// - `auto`: overlay on a successful probe (once ready), otherwise copy, always
///   with the reason recorded so the choice is never ambiguous.
pub fn select(
    request: Request,
    overlay_ready: bool,
    probe: impl FnOnce() -> Result<()>,
) -> Result<Selection> {
    match request {
        Request::Copy => Ok(Selection {
            engine: Engine::Copy,
            reason: "COMPOSERY_PERSISTENCE=copy".into(),
        }),
        Request::Overlay => {
            if !overlay_ready {
                bail!(
                    "COMPOSERY_PERSISTENCE=overlay was requested but the overlay engine is not available in this build; unset COMPOSERY_PERSISTENCE (auto) or set it to copy"
                );
            }
            probe().context(
                "COMPOSERY_PERSISTENCE=overlay was requested but the overlay probe failed",
            )?;
            Ok(Selection {
                engine: Engine::Overlay,
                reason: "COMPOSERY_PERSISTENCE=overlay; overlay probe succeeded".into(),
            })
        }
        Request::Auto => {
            if !overlay_ready {
                return Ok(Selection {
                    engine: Engine::Copy,
                    reason: "auto: overlay engine not yet available in this build".into(),
                });
            }
            match probe() {
                Ok(()) => Ok(Selection {
                    engine: Engine::Overlay,
                    reason: "auto: overlay probe succeeded".into(),
                }),
                Err(error) => Ok(Selection {
                    engine: Engine::Copy,
                    reason: format!("auto: overlay probe failed ({error:#}); using copy"),
                }),
            }
        }
    }
}

/// Select the engine from the environment, probing the real `/data` volume,
/// then record the choice and reason where `persistence status` can report it
/// and return the selection for the entrypoint. Silent or ambiguous engine
/// selection is unacceptable, so the reason is always persisted and logged.
pub fn select_and_record(paths: &Paths) -> Result<Selection> {
    let request = Request::from_env()?;
    let selection = select(request, OVERLAY_ENGINE_READY, || {
        probe_overlay(&paths.data_dir)
    })?;
    layout::ensure(paths)?;
    let db = StateDb::open_or_rebuild(paths)?;
    db.record_diagnostic("engine", selection.engine.as_str())?;
    db.record_diagnostic("engine_reason", &selection.reason)?;
    tracing::info!(
        engine = selection.engine.as_str(),
        reason = %selection.reason,
        "persistence engine selected"
    );
    Ok(selection)
}

/// Probe overlay support by *doing* it: mount a throwaway overlayfs whose upper
/// and work dirs sit on the real `/data` volume (per the spike, a `/tmp` probe
/// would test the wrong filesystem's xattr support), then unmount and clean up.
/// Returns the real failure - `EPERM` at `mount()` when unprivileged - so an
/// explicit `overlay` pin can surface it. The full boot then rebuilds the same
/// overlay for real in `init/overlay.sh`; this only decides the engine.
#[cfg(target_os = "linux")]
pub fn probe_overlay(volume_dir: &Path) -> Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let probe_root = volume_dir.join(".internal/overlay-probe");
    let _ = std::fs::remove_dir_all(&probe_root);
    for sub in ["lower", "upper", "work", "merged"] {
        let dir = probe_root.join(sub);
        std::fs::create_dir_all(&dir)
            .with_context(|| format!("create overlay probe dir {}", dir.display()))?;
    }

    // ponytail: the volume root is ASCII (`/data`), so `display()` in the mount
    // options is fine here; the real engine builds these from bytes.
    let options = format!(
        "lowerdir={},upperdir={},workdir={}",
        probe_root.join("lower").display(),
        probe_root.join("upper").display(),
        probe_root.join("work").display()
    );
    let merged = probe_root.join("merged");
    let source = CString::new("overlay").expect("static string has no NUL");
    let fstype = CString::new("overlay").expect("static string has no NUL");
    let target = CString::new(merged.as_os_str().as_bytes()).context("probe path contains NUL")?;
    let data = CString::new(options).context("probe options contain NUL")?;

    let mounted = unsafe {
        libc::mount(
            source.as_ptr(),
            target.as_ptr(),
            fstype.as_ptr(),
            0,
            data.as_ptr() as *const libc::c_void,
        )
    };
    let result = if mounted == 0 {
        let unmounted = unsafe { libc::umount2(target.as_ptr(), libc::MNT_DETACH) };
        if unmounted == 0 {
            Ok(())
        } else {
            Err(std::io::Error::last_os_error()).context("unmount overlay probe")
        }
    } else {
        Err(std::io::Error::last_os_error()).context("overlay mount probe on the data volume")
    };
    let _ = std::fs::remove_dir_all(&probe_root);
    result
}

#[cfg(not(target_os = "linux"))]
pub fn probe_overlay(_volume_dir: &Path) -> Result<()> {
    anyhow::bail!("the overlay engine is only supported on Linux");
}

#[cfg(test)]
mod tests {
    use super::{Engine, OVERLAY_ENGINE_READY, Request, select};
    use std::cell::Cell;

    #[test]
    fn parses_the_engine_request_and_rejects_unknown_values() {
        assert_eq!(Request::parse(None).unwrap(), Request::Auto);
        assert_eq!(Request::parse(Some("")).unwrap(), Request::Auto);
        assert_eq!(Request::parse(Some(" auto ")).unwrap(), Request::Auto);
        assert_eq!(Request::parse(Some("overlay")).unwrap(), Request::Overlay);
        assert_eq!(Request::parse(Some("copy")).unwrap(), Request::Copy);

        let error = Request::parse(Some("overlayfs")).unwrap_err().to_string();
        assert!(error.contains("unsupported COMPOSERY_PERSISTENCE"));
        assert!(error.contains("overlayfs"));
    }

    #[test]
    fn copy_is_always_honoured_without_probing() {
        let probed = Cell::new(false);
        for ready in [false, true] {
            let selection = select(Request::Copy, ready, || {
                probed.set(true);
                Ok(())
            })
            .unwrap();
            assert_eq!(selection.engine, Engine::Copy);
        }
        assert!(!probed.get(), "copy must never run the overlay probe");
    }

    #[test]
    fn auto_uses_copy_and_skips_the_probe_until_overlay_is_ready() {
        let probed = Cell::new(false);
        let selection = select(Request::Auto, false, || {
            probed.set(true);
            Ok(())
        })
        .unwrap();
        assert_eq!(selection.engine, Engine::Copy);
        assert!(selection.reason.contains("not yet available"));
        assert!(
            !probed.get(),
            "auto must not probe while overlay is unready"
        );
    }

    #[test]
    fn auto_picks_overlay_on_a_successful_probe_and_copy_on_failure() {
        let overlay = select(Request::Auto, true, || Ok(())).unwrap();
        assert_eq!(overlay.engine, Engine::Overlay);
        assert!(overlay.reason.contains("probe succeeded"));

        let fallback = select(Request::Auto, true, || anyhow::bail!("EPERM at fsopen")).unwrap();
        assert_eq!(fallback.engine, Engine::Copy);
        assert!(fallback.reason.contains("EPERM at fsopen"));
        assert!(fallback.reason.contains("using copy"));
    }

    #[test]
    fn explicit_overlay_fails_loudly_when_unavailable_never_downgrades() {
        // Engine not ready in this build: refuse rather than silently use copy.
        let not_ready = select(Request::Overlay, false, || Ok(()))
            .unwrap_err()
            .to_string();
        assert!(not_ready.contains("not available in this build"));

        // Ready but the probe fails (unprivileged host): surface the real cause.
        // `{:#}` is how the CLI prints the error chain, so the probe's reason
        // reaches the operator rather than only the top-level context.
        let probe_failed = format!(
            "{:#}",
            select(Request::Overlay, true, || anyhow::bail!("EPERM at fsopen")).unwrap_err()
        );
        assert!(probe_failed.contains("overlay probe failed"));
        assert!(probe_failed.contains("EPERM at fsopen"));

        // Ready and probe succeeds: overlay.
        let ok = select(Request::Overlay, true, || Ok(())).unwrap();
        assert_eq!(ok.engine, Engine::Overlay);
    }

    #[test]
    fn this_build_ships_with_overlay_gated_off() {
        // The overlay code is written and unit-tested, but nothing has booted a
        // container onto an overlay root yet, so the shipped constant is still
        // off and `auto` resolves to copy everywhere. Driven through the real
        // constant: flipping it on without the boot harness passing makes the
        // probe below fire and this test fail, which is the point - the gate
        // moves as the last step of verification, never ahead of it.
        let selection = select(Request::Auto, OVERLAY_ENGINE_READY, || {
            panic!("must not probe while overlay is gated off")
        })
        .unwrap();
        assert_eq!(selection.engine, Engine::Copy);
    }
}
