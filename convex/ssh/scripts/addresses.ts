/** Reports global IPv6 addresses from the kernel; the provider range is checked elsewhere. */
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
