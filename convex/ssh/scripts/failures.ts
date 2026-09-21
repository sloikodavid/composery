/** What a remote program names on stderr when the server cannot do the work. */
export const sshUnsupportedMessage =
	"Composery needs something this server does not provide";

/**
 * A program that cannot do its work exits as a shell does for a command it cannot
 * run, so `commandExitCodes` reads either as `command_unavailable`, which
 * `../failures.ts` reports as `server_unsupported`.
 */
export const sshUnsupportedExitCode = 127;

export const sshFailureScript = `import sys

def unsupported(part):
    """Name the missing part on stderr, and leave stdout empty so the caller knows."""
    print("${sshUnsupportedMessage}: " + part, file=sys.stderr)
    raise SystemExit(${sshUnsupportedExitCode})
`;
