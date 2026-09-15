/** Fixed remote Linux program. It changes the hostname only when it is still the old one. */
export const hostnameScript = `import json, shutil, subprocess, sys

def now():
    try:
        done = subprocess.run(["hostname"], capture_output=True, text=True, timeout=10)
    except Exception:
        return None
    return done.stdout.strip() if done.returncode == 0 else None

request = json.loads(sys.stdin.read(4096))
current = now()
# A hostname the customer chose is theirs; only one that still matches the old name moves.
if current is not None and (request["expected"] is None or current == request["expected"]):
    tool = shutil.which("hostnamectl")
    try:
        if tool:
            subprocess.run([tool, "set-hostname", request["next"]],
                           capture_output=True, timeout=20)
        else:
            with open("/etc/hostname", "w") as handle:
                handle.write(request["next"] + "\\n")
            subprocess.run(["hostname", request["next"]], capture_output=True, timeout=10)
    except Exception:
        pass
    current = now()
print(json.dumps({"hostname": current}))
`;
