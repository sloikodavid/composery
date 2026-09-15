/** The token never enters command arguments or output. */
export const reportHostKeyScript = `import json, pathlib, time, urllib.request
config_path = pathlib.Path("/run/composery-bootstrap.json")
config = json.loads(config_path.read_text())
host_key = pathlib.Path("/etc/ssh/ssh_host_ed25519_key.pub").read_text().split()
body = json.dumps(dict(allocationId=config["allocationId"], token=config["token"],
                       hostKey=" ".join(host_key[:2]))).encode()
request = urllib.request.Request(config["url"], data=body, headers={"Content-Type": "application/json"})
success = False
for attempt in range(30):
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            success = response.status == 204
        if success:
            break
    except Exception:
        pass
    time.sleep(min(20, 1 + attempt))
config_path.unlink(missing_ok=True)
if not success:
    raise SystemExit("Composery host key registration failed.")
`;
