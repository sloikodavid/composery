import { sshConfigurationScript } from "./configuration";
import { sshFailureScript } from "./failures";
import { sshHostKeyScript } from "./host_key";

/** Sends the host key without putting the bootstrap token in arguments or output. */
export const reportHostKeyScript = `import json, pathlib, time, urllib.request
${sshFailureScript}
${sshConfigurationScript}
${sshHostKeyScript}
config_path = pathlib.Path("/run/composery-bootstrap.json")
config = json.loads(config_path.read_text())

answer = ask_sshd()
if answer is None:
    unsupported("the SSH server's own configuration")
host_key = read_host_key(directive_values(read_directives(answer[0]), "hostkey"))
if host_key is None:
    unsupported("Ed25519 host key")
body = json.dumps(dict(allocationId=config["allocationId"], token=config["token"],
                       hostKey=host_key)).encode()
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
