/** Fixed remote Linux program. It reports what the SSH server says, and never guesses. */
export const discoveryScript = `import fnmatch, grp, json, os, pwd, shutil, stat, subprocess

MAX_ACCOUNTS = 50
MAX_FILES = 20

def sshd():
    return shutil.which("sshd") or "/usr/sbin/sshd"

def ask(arguments):
    # -G prints the effective configuration; -T also runs checks that fail for unrelated reasons.
    for flag in ("-G", "-T"):
        try:
            done = subprocess.run([sshd(), flag] + arguments, capture_output=True,
                                  text=True, timeout=20)
        except Exception:
            return None
        if done.returncode == 0:
            return done.stdout
    return None

def parse(text):
    settings = {}
    for line in (text or "").splitlines():
        name, _, value = line.strip().partition(" ")
        if name:
            settings.setdefault(name, []).append(value)
    return settings

def first(settings, name, fallback):
    values = settings.get(name)
    return values[0] if values else fallback

def words(settings, name):
    return " ".join(settings.get(name, [])).split()

def split_paths(value):
    # sshd's parser separates on whitespace and lets double quotes hold a name together.
    parts, current, quoted, started = [], "", False, False
    for character in value:
        if character == '"':
            quoted, started = not quoted, True
        elif character.isspace() and not quoted:
            if current or started:
                parts.append(current)
            current, started = "", False
        else:
            current += character
    if current or started:
        parts.append(current)
    return parts

def expand(pattern, account):
    # One pass: a home directory that itself contains a token is not expanded again.
    tokens = {"%%": "%", "%h": account.pw_dir, "%u": account.pw_name,
              "%U": str(account.pw_uid)}
    out, index = "", 0
    while index < len(pattern):
        token = pattern[index:index + 2]
        if token in tokens:
            out += tokens[token]
            index += 2
        else:
            out += pattern[index]
            index += 1
    return out if out.startswith("/") else os.path.join(account.pw_dir, out)

def is_safe(path, account):
    # StrictModes: the file and every canonical parent up to the home directory must be owned
    # by the account or by root, and must not be writable by group or others.
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
        status = os.stat(path)
    except FileNotFoundError:
        return {"kind": "file", "path": path, "state": "missing"}
    except OSError:
        return {"kind": "file", "path": path, "state": "unreadable"}
    if not stat.S_ISREG(status.st_mode):
        return {"kind": "file", "path": path, "state": "unusable"}
    if strict and not is_safe(path, account):
        return {"kind": "file", "path": path, "state": "unsafe"}
    return {"kind": "file", "path": path, "state": "present"}

def sources(settings, account, strict):
    found, ambiguous = [], False
    # sshd reads these paths literally: it does not expand shell patterns in them.
    patterns = [p for p in split_paths(first(settings, "authorizedkeysfile",
                                             ".ssh/authorized_keys")) if p != "none"]
    for pattern in patterns[:MAX_FILES]:
        found.append(describe(expand(pattern, account), account, strict))
    # The effective configuration prints a quoted name unquoted, so one name that holds a
    # space cannot be told from several names. A file that exists under the joined name says
    # which reading was meant, and the caller is told that the names were ambiguous.
    if len(patterns) > 1 and any(entry["state"] == "missing" for entry in found):
        joined = describe(expand(" ".join(patterns), account), account, strict)
        if joined["state"] != "missing":
            found.append(joined)
            ambiguous = True
    command = first(settings, "authorizedkeyscommand", "none")
    if command and command != "none":
        found.append({"kind": "command", "command": command})
    for name in ("trustedusercakeys", "authorizedprincipalsfile"):
        value = first(settings, name, "none")
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

def admitted(settings, account):
    try:
        groups = groups_of(account)
    except Exception:
        groups = set()
    deny_users, allow_users = words(settings, "denyusers"), words(settings, "allowusers")
    deny_groups, allow_groups = words(settings, "denygroups"), words(settings, "allowgroups")
    if matches(deny_users, account.pw_name):
        return False
    if any(matches(deny_groups, group) for group in groups):
        return False
    if allow_users and not matches(allow_users, account.pw_name):
        return False
    if allow_groups and not any(matches(allow_groups, group) for group in groups):
        return False
    return True

def conditional(settings):
    # A pattern that names a host or an address is decided per connection, not here.
    for name in ("denyusers", "allowusers", "denygroups", "allowgroups"):
        if any("@" in pattern for pattern in words(settings, name)):
            return True
    return False

connection = (os.environ.get("SSH_CONNECTION") or "").split()
# One -C carries every field: sshd takes the last option, not the union of several.
context = ["addr=" + connection[0], "host=" + connection[0],
           "laddr=" + connection[2], "lport=" + connection[3]] if len(connection) == 4 else []
global_settings = parse(ask([]))
if not global_settings:
    print(json.dumps({"error": "sshd_unavailable"}))
    raise SystemExit(0)

everyone = sorted(pwd.getpwall(), key=lambda account: account.pw_uid)
accounts = []
for account in everyone[:MAX_ACCOUNTS]:
    answer = ask(["-C", ",".join(context + ["user=" + account.pw_name])])
    settings = parse(answer) if answer else global_settings
    methods = first(settings, "authenticationmethods", "any")
    chains = methods.split()
    root_login = first(settings, "permitrootlogin", "prohibit-password")
    is_root = account.pw_uid == 0
    found, ambiguous = sources(settings, account,
                               first(settings, "strictmodes", "yes") == "yes")
    accepts = (first(settings, "pubkeyauthentication", "yes") == "yes"
               and (methods == "any" or any(chain.split(",")[0] == "publickey"
                                            for chain in chains))
               and admitted(settings, account)
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
        "decidedPerConnection": bool(conditional(settings)),
        "forcedCommandOnly": bool(is_root and root_login == "forced-commands-only"),
        "sources": found,
        "namesAmbiguous": ambiguous,
    })

print(json.dumps({
    "usesPam": first(global_settings, "usepam", "no") == "yes",
    "strictModes": first(global_settings, "strictmodes", "yes") == "yes",
    "accountsTruncated": len(everyone) > MAX_ACCOUNTS,
    "accounts": accounts,
}))
`;
