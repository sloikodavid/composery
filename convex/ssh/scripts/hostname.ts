import { sshFailureScript } from "./failures";

/** Changes the hostname only when it still matches the expected previous value. */
export const hostnameScript = `import json, shutil, subprocess, sys
${sshFailureScript}
def now():
    try:
        tool = shutil.which("hostname")
        if not tool:
            return None
        done = subprocess.run([tool], capture_output=True, text=True, timeout=10)
    except Exception:
        return None
    return done.stdout.strip() if done.returncode == 0 else None

request = json.loads(sys.stdin.read(4096))
current = now()
if current is None:
    unsupported("hostname")
if request["expected"] is not None and current != request["expected"]:
    print(json.dumps({"hostname": current}))
    raise SystemExit(0)
if current == request["next"]:
    print(json.dumps({"hostname": current}))
    raise SystemExit(0)
tool = shutil.which("hostnamectl")
if tool:
    try:
        done = subprocess.run([tool, "set-hostname", request["next"]],
                              capture_output=True, timeout=20)
    except Exception:
        unsupported("hostname")
else:
    tool = shutil.which("hostname")
    if not tool:
        unsupported("hostname")
    try:
        done = subprocess.run([tool, request["next"]], capture_output=True, timeout=10)
    except Exception:
        unsupported("hostname")
if done.returncode != 0:
    unsupported("hostname")
current = now()
if current != request["next"]:
    unsupported("hostname")
print(json.dumps({"hostname": current}))
`;
