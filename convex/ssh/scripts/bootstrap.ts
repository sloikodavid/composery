import type { SshBootstrapFile } from "../bootstrap_state";
import { sshAccountPathScript } from "./account_path";
import { sshAuthorizedPathsScript } from "./authorized_paths";
import { sshConfigurationScript } from "./configuration";
import {
	sshFailureScript,
	sshUnsupportedExitCode,
	sshUnsupportedMessage,
} from "./failures";
import { sshHostKeyScript } from "./host_key";
import { quoteShell } from "./shell";

const bootstrapProgram = `import json, os, pathlib, stat, sys, tempfile, urllib.request
${sshFailureScript}
${sshConfigurationScript}
${sshAuthorizedPathsScript}
${sshAccountPathScript}
${sshHostKeyScript}
request = json.loads(sys.stdin.read())

def key_fields(line, target):
    return target.encode("ascii") in line.split()

def without_key(data, target):
    if not target:
        return data
    return b"".join(line for line in data.splitlines(keepends=True)
                    if not key_fields(line, target))

def replace(path, data, old_stat):
    directory = os.path.dirname(path) or "."
    descriptor = None
    temporary = None
    try:
        descriptor, temporary = tempfile.mkstemp(prefix=".composery-", dir=directory)
        os.fchmod(descriptor, stat.S_IMODE(old_stat.st_mode))
        try:
            os.fchown(descriptor, old_stat.st_uid, old_stat.st_gid)
        except OSError:
            unsupported("file ownership preservation")
        with os.fdopen(descriptor, "wb") as handle:
            descriptor = None
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if descriptor is not None:
            os.close(descriptor)
        if temporary is not None:
            try:
                os.unlink(temporary)
            except OSError:
                pass

answer = ask_sshd()
if answer is None:
    unsupported("the SSH server's own configuration")
config, diagnostics = answer
directives = read_directives(config)
authorized = directive_values(directives, "authorizedkeysfile")
if not authorized:
    unsupported("authorized keys file")
patterns = read_authorized_paths(authorized[0], diagnostics)
if not patterns or "none" in patterns:
    unsupported("authorized keys file")

key_path = None
for pattern in patterns:
    candidate = expand_account_path(pattern)
    if os.path.lexists(candidate) and os.path.islink(candidate):
        candidate = os.path.realpath(candidate)
    if os.path.isfile(candidate):
        key_path = candidate
        break
if key_path is None:
    key_path = expand_account_path(patterns[0])
    os.makedirs(os.path.dirname(key_path) or ".", exist_ok=True)
    try:
        descriptor = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        try:
            descriptor = os.open(key_path, os.O_WRONLY | os.O_NOFOLLOW)
        except OSError:
            unsupported("authorized keys file")
    except OSError:
        unsupported("authorized keys file")
    os.close(descriptor)
if not os.path.isfile(key_path):
    unsupported("authorized keys file")

old_stat = os.stat(key_path, follow_symlinks=False)
data = pathlib.Path(key_path).read_bytes()
new_key = request["publicKey"]
old_key = request["previousPublicKey"].split(" ")[1] if " " in request["previousPublicKey"] else ""
staged = without_key(data, new_key.split(" ")[1])
if staged and not staged.endswith((b"\\n", b"\\r")):
    staged += b"\\n"
staged += (new_key + "\\n").encode("utf-8")
replace(key_path, staged, old_stat)

host_key = read_host_key(directive_values(directives, "hostkey"))
if host_key is None:
    unsupported("Ed25519 host key")

ports = directive_values(directives, "port")
if len(ports) != 1 or not ports[0].isdigit() or not 1 <= int(ports[0]) <= 65535:
    unsupported("SSH port")
body = json.dumps({"allocationId": request["allocationId"], "token": request["token"],
                   "hostKey": host_key, "port": int(ports[0])}).encode()
try:
    with urllib.request.urlopen(urllib.request.Request(
            request["url"], data=body, headers={"Content-Type": "application/json"}), timeout=10) as response:
        if response.status != 204:
            unsupported("host-key registration")
except Exception as error:
    raise SystemExit("Composery host-key report failed: " + str(error))

if old_key:
    before_remove = os.stat(key_path, follow_symlinks=False)
    current = pathlib.Path(key_path).read_bytes()
    after_read = os.stat(key_path, follow_symlinks=False)
    if (current != staged or before_remove.st_ino != after_read.st_ino or
            before_remove.st_mtime_ns != after_read.st_mtime_ns or
            before_remove.st_size != after_read.st_size):
        raise SystemExit("Composery host-key report succeeded; the key file changed, so the old key remains.")
    replace(key_path, without_key(current, old_key), before_remove)
`;

/** Uses the effective SSH configuration and keeps the old key until registration succeeds. */
export function renderSshBootstrapScript({
	bootstrapFile,
	publicKey,
	previousPublicKey,
}: {
	bootstrapFile: SshBootstrapFile;
	publicKey: string;
	previousPublicKey: string;
}) {
	const input = JSON.stringify({
		allocationId: bootstrapFile.allocationId,
		token: bootstrapFile.token,
		url: bootstrapFile.url,
		publicKey,
		previousPublicKey,
	});
	return `set -eu
python_path=$(command -v python3 2>/dev/null || true)
if [ -z "$python_path" ] || [ ! -x "$python_path" ]; then
  printf '%s\\n' ${quoteShell(`${sshUnsupportedMessage}: python3`)} >&2
  exit ${sshUnsupportedExitCode}
fi
printf '%s' ${quoteShell(input)} | "$python_path" -I -X utf8 -c ${quoteShell(bootstrapProgram)}`;
}
