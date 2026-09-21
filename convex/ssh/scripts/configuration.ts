/** Asks the running SSH server what it is doing, instead of reading its files. */
export const sshConfigurationScript = `import shutil, subprocess

SSHD_TIMEOUT_SECONDS = 20

def ask_sshd(arguments=()):
    """The effective configuration and the diagnostics behind it, or None when sshd will not say."""
    sshd = shutil.which("sshd")
    if not sshd:
        return None
    for flag in ("-G", "-T"):
        try:
            done = subprocess.run([sshd, flag, "-ddd"] + list(arguments),
                                  capture_output=True, text=True,
                                  timeout=SSHD_TIMEOUT_SECONDS)
        except Exception:
            continue
        if done.returncode == 0:
            return done.stdout, done.stderr
    return None

def read_directives(effective):
    """Every directive the dump names, each with its values in the order it gave them."""
    directives = {}
    for line in (effective or "").splitlines():
        name, _, value = line.strip().partition(" ")
        if name:
            directives.setdefault(name, []).append(value.strip())
    return directives

def directive_values(directives, name):
    return [value for value in directives.get(name, []) if value]

def first_directive(directives, name, fallback):
    values = directives.get(name)
    return values[0] if values else fallback
`;
