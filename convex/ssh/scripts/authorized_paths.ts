/** Works out which files the running SSH server reads keys from, for one account. */
export const sshAuthorizedPathsScript = `import re, shlex

def read_authorized_paths(effective, diagnostics):
    """Retains the quoted path boundaries that the effective dump flattens."""
    candidates = set()
    found = False
    for line in diagnostics.splitlines():
        match = re.match(r"^debug3: .*:[0-9]+ setting authorizedkeysfile (.*)$", line, re.IGNORECASE)
        if not match:
            continue
        found = True
        try:
            paths = tuple(shlex.split(match.group(1), comments=True))
        except ValueError:
            return None
        if " ".join(paths) == effective:
            candidates.add(paths)
    if len(candidates) == 1:
        return list(next(iter(candidates)))
    if found or len(candidates) > 1:
        return None
    # OpenSSH omits a debug assignment for built-in defaults. Its effective
    # dump is the only native description in that case, so retain those words;
    # an explicit assignment always takes the diagnostics path above.
    return effective.split()
`;
