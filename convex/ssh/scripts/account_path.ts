/** Expands the tokens OpenSSH allows in a path it reads for one account. */
export const sshAccountPathScript = `import os, pwd

def expand_account_path(pattern, account=None):
    """A pattern as OpenSSH reads it, against the home of the account it belongs to."""
    if account is None:
        account = pwd.getpwuid(os.geteuid())
    tokens = {"%%": "%", "%h": account.pw_dir, "%u": account.pw_name,
              "%U": str(account.pw_uid)}
    path, index = "", 0
    while index < len(pattern):
        token = pattern[index:index + 2]
        if token in tokens:
            path += tokens[token]
            index += 2
        else:
            path += pattern[index]
            index += 1
    return path if os.path.isabs(path) else os.path.join(account.pw_dir, path)
`;
