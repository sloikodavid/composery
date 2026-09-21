import { sshAccountPathScript } from "./account_path";
import { sshAuthorizedPathsScript } from "./authorized_paths";
import { sshConfigurationScript } from "./configuration";

/** Fixed remote program; reports effective sshd behavior without guessing paths. */
export const discoveryScript = `import fnmatch, grp, json, os, pwd, stat
${sshConfigurationScript}
${sshAuthorizedPathsScript}
${sshAccountPathScript}
MAX_ACCOUNTS = 50
MAX_FILES = 20

def words(directives, name):
    return " ".join(directives.get(name, [])).split()

def is_safe(path, account):
    current = os.path.realpath(path)
    home = os.path.realpath(account.pw_dir)
    while True:
        try:
            status = os.stat(current)
        except OSError:
            return False
        if status.st_uid not in (0, account.pw_uid) or status.st_mode & 0o022:
            return False
        if current in ("/", home):
            return True
        parent = os.path.dirname(current)
        if parent == current:
            return True
        current = parent

def describe(path, account, strict):
    try:
        link = os.lstat(path)
    except FileNotFoundError:
        return {"kind": "file", "path": path, "status": "missing"}
    except OSError:
        return {"kind": "file", "path": path, "status": "unreadable"}
    if stat.S_ISLNK(link.st_mode):
        return {"kind": "file", "path": path, "status": "unsafe"}
    try:
        status = os.stat(path)
    except OSError:
        return {"kind": "file", "path": path, "status": "unreadable"}
    if not stat.S_ISREG(status.st_mode):
        return {"kind": "file", "path": path, "status": "unusable"}
    if strict and not is_safe(path, account):
        return {"kind": "file", "path": path, "status": "unsafe"}
    return {"kind": "file", "path": path, "status": "present"}

def sources(directives, diagnostics, account, strict):
    found, ambiguous = [], False
    paths = read_authorized_paths(first_directive(directives, "authorizedkeysfile", "none"), diagnostics)
    ambiguous = paths is None
    patterns = [p for p in (paths or []) if p != "none"]
    for pattern in patterns[:MAX_FILES]:
        found.append(describe(expand_account_path(pattern, account), account, strict))
    command = first_directive(directives, "authorizedkeyscommand", "none")
    if command and command != "none":
        found.append({"kind": "command", "command": command})
    for name in ("trustedusercakeys", "authorizedprincipalsfile"):
        value = first_directive(directives, name, "none")
        if value and value != "none":
            found.append({"kind": "certificate", "setting": name, "value": value})
    return found, ambiguous

def groups_of(account):
    names = set()
    try:
        names.add(grp.getgrgid(account.pw_gid).gr_name)
    except Exception:
        pass
    for group in grp.getgrall():
        if account.pw_name in group.gr_mem:
            names.add(group.gr_name)
    return names

def matches(patterns, name):
    return any(fnmatch.fnmatch(name, pattern.split("@")[0]) for pattern in patterns)

def admitted(directives, account):
    try:
        groups = groups_of(account)
    except Exception:
        groups = set()
    deny_users, allow_users = words(directives, "denyusers"), words(directives, "allowusers")
    deny_groups, allow_groups = words(directives, "denygroups"), words(directives, "allowgroups")
    if matches(deny_users, account.pw_name):
        return False
    if any(matches(deny_groups, group) for group in groups):
        return False
    if allow_users and not matches(allow_users, account.pw_name):
        return False
    if allow_groups and not any(matches(allow_groups, group) for group in groups):
        return False
    return True

def conditional(directives):
    for name in ("denyusers", "allowusers", "denygroups", "allowgroups"):
        if any("@" in pattern for pattern in words(directives, name)):
            return True
    return False

connection = (os.environ.get("SSH_CONNECTION") or "").split()
context = ["addr=" + connection[0], "host=" + connection[0],
           "laddr=" + connection[2], "lport=" + connection[3]] if len(connection) == 4 else []
global_answer = ask_sshd()
global_directives = read_directives(global_answer[0] if global_answer else None)
if not global_directives:
    print(json.dumps({"error": "sshd_unavailable"}))
    raise SystemExit(0)

everyone = sorted(pwd.getpwall(), key=lambda account: account.pw_uid)
accounts = []
for account in everyone[:MAX_ACCOUNTS]:
    answer = ask_sshd(["-C", ",".join(context + ["user=" + account.pw_name])])
    directives = read_directives(answer[0]) if answer else global_directives
    diagnostics = answer[1] if answer else global_answer[1]
    methods = first_directive(directives, "authenticationmethods", "any")
    chains = methods.split()
    root_login = first_directive(directives, "permitrootlogin", "prohibit-password")
    is_root = account.pw_uid == 0
    found, ambiguous = sources(directives, diagnostics, account,
                               first_directive(directives, "strictmodes", "yes") == "yes")
    accepts = (first_directive(directives, "pubkeyauthentication", "yes") == "yes"
               and (methods == "any" or any(chain.split(",")[0] == "publickey"
                                            for chain in chains))
               and admitted(directives, account)
               and (not is_root or root_login != "no"))
    accounts.append({
        "name": account.pw_name,
        "home": account.pw_dir,
        "shell": account.pw_shell,
        "acceptsPublicKeys": bool(accepts),
        "publicKeyAloneSignsIn": bool(accepts and (methods == "any"
                                                   or any(chain == "publickey"
                                                          for chain in chains))),
        "settingsAnswered": bool(answer),
        "decidedPerConnection": bool(conditional(directives)),
        "forcedCommandOnly": bool(is_root and root_login == "forced-commands-only"),
        "sources": found,
        "namesAmbiguous": ambiguous,
    })

print(json.dumps({
    "usesPam": first_directive(global_directives, "usepam", "no") == "yes",
    "strictModes": first_directive(global_directives, "strictmodes", "yes") == "yes",
    "accountsTruncated": len(everyone) > MAX_ACCOUNTS,
    "accounts": accounts,
}))
`;
