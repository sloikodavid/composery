/**
 * Asks a server which addresses it answers on. A provider gives a server a range and the server
 * decides which address inside it to use, so this is the only place that knows: the kernel's own
 * list, in the form Python's library writes it, rather than anything we would have to guess.
 *
 * The kernel says which addresses are global and which reach nobody outside the machine, and it
 * is the only opinion here: whether a global one is the server's own is decided against the
 * range the provider gave it, which is a question this program cannot answer.
 */
export const addressesScript = `
import ipaddress
import json

GLOBAL_SCOPE = "00"
found = []
try:
    with open("/proc/net/if_inet6", "r", encoding="ascii") as handle:
        for line in handle:
            parts = line.split()
            if len(parts) < 6 or parts[3] != GLOBAL_SCOPE:
                continue
            try:
                address = ipaddress.ip_address(bytes.fromhex(parts[0]))
            except ValueError:
                continue
            if str(address) not in found:
                found.append(str(address))
except OSError:
    pass
print(json.dumps({"ipv6": found}))
`;
