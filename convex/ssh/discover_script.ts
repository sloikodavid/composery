/** Fixed remote Linux program. It reports what the SSH server says, and never guesses. */
export const discoverScript = `import glob, json, os, pwd, shutil, subprocess

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

def expand(pattern, account):
    path = pattern.replace("%%", "\\x00").replace("%h", account.pw_dir)
    path = path.replace("%u", account.pw_name).replace("%U", str(account.pw_uid))
    path = path.replace("\\x00", "%")
    return path if path.startswith("/") else os.path.join(account.pw_dir, path)

def describe(path):
    try:
        status = os.stat(path, follow_symlinks=False)
    except FileNotFoundError:
        return {"path": path, "state": "missing"}
    except OSError:
        return {"path": path, "state": "unreadable"}
    # StrictModes refuses a file that others can write, or a path that others own.
    unsafe = bool(status.st_mode & 0o022) or status.st_uid not in (0, os.stat(os.path.dirname(path)).st_uid)
    return {"path": path, "state": "unsafe" if unsafe else "present",
            "size": status.st_size, "mode": status.st_mode & 0o7777}

def sources(settings, account):
    found = []
    patterns = (settings.get("authorizedkeysfile") or [".ssh/authorized_keys"])[0].split()
    for pattern in patterns[:MAX_FILES]:
        if pattern == "none":
            continue
        path = expand(pattern, account)
        is_pattern = any(character in path for character in "*?[")
        matches = sorted(glob.glob(path))[:MAX_FILES] if is_pattern else [path]
        for match in matches or [path]:
            found.append(dict(describe(match), kind="file"))
    command = (settings.get("authorizedkeyscommand") or ["none"])[0]
    if command and command != "none":
        found.append({"kind": "command", "command": command})
    for name in ("trustedusercakeys", "authorizedprincipalsfile"):
        value = (settings.get(name) or ["none"])[0]
        if value and value != "none":
            found.append({"kind": "certificate", "setting": name, "value": value})
    return found

connection = (os.environ.get("SSH_CONNECTION") or "").split()
# One -C carries every field: sshd takes the last option, not the union of several.
context = ["addr=" + connection[0], "host=" + connection[0],
           "laddr=" + connection[2], "lport=" + connection[3]] if len(connection) == 4 else []
global_settings = parse(ask([]))
if not global_settings:
    print(json.dumps({"error": "sshd_unavailable"}))
    raise SystemExit(0)

accounts = []
for account in sorted(pwd.getpwall(), key=lambda a: a.pw_uid)[:MAX_ACCOUNTS]:
    fields = ",".join(context + ["user=" + account.pw_name])
    settings = parse(ask(["-C", fields])) or global_settings
    methods = (settings.get("authenticationmethods") or ["any"])[0]
    root_login = (settings.get("permitrootlogin") or ["prohibit-password"])[0]
    accounts.append({
        "name": account.pw_name,
        "home": account.pw_dir,
        "shell": account.pw_shell,
        "keysEnabled": (settings.get("pubkeyauthentication") or ["yes"])[0] == "yes"
            and (account.pw_uid != 0 or root_login in ("yes", "prohibit-password", "without-password")),
        "keyAloneSignsIn": methods == "any" or any(
            chain.split(",")[0] == "publickey" and len(chain.split(",")) == 1
            for chain in methods.split()),
        "sources": sources(settings, account),
    })

print(json.dumps({
    "port": int((global_settings.get("port") or ["22"])[0]),
    "usesPam": (global_settings.get("usepam") or ["no"])[0] == "yes",
    "strictModes": (global_settings.get("strictmodes") or ["yes"])[0] == "yes",
    "accounts": accounts,
}))
`;
