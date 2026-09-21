/** Reads the Ed25519 host key that the running SSH server presents. */
export const sshHostKeyScript = `import os, pathlib

def read_host_key(paths):
    """The configured Ed25519 host key as "type base64", or None when no path holds one."""
    for path in paths:
        # sshd reports a relative path as it was written, and never what it was
        # relative to. The account's home is the one candidate we can name, and
        # a wrong guess only fails to open.
        if not os.path.isabs(path):
            path = os.path.join(os.path.expanduser("~"), path)
        try:
            fields = pathlib.Path(path + ".pub").read_text().split()
        except OSError:
            continue
        if len(fields) >= 2 and fields[0] == "ssh-ed25519":
            return " ".join(fields[:2])
    return None
`;
