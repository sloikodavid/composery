// biome-ignore-start lint/style/useNamingConvention: external field names
const anySource = ["0.0.0.0/0", "::/0"];

/** Product-owned rules; outbound remains open for bootstrap and host-key reports. */

export const hetznerCloudFirewallRules = [
	{
		description: "SSH, which is how a customer and Composery reach the server",
		direction: "in",
		protocol: "tcp",
		port: "22",
		source_ips: anySource,
	},
	{
		description: "HTTP, which a customer's own service answers on",
		direction: "in",
		protocol: "tcp",
		port: "80",
		source_ips: anySource,
	},
	{
		description: "HTTPS over TCP",
		direction: "in",
		protocol: "tcp",
		port: "443",
		source_ips: anySource,
	},
	{
		description: "HTTPS over QUIC",
		direction: "in",
		protocol: "udp",
		port: "443",
		source_ips: anySource,
	},
	{
		description:
			"ICMP, so that a server answers a ping and reports what it cannot deliver",
		direction: "in",
		protocol: "icmp",
		source_ips: anySource,
	},
] as const;
// biome-ignore-end lint/style/useNamingConvention: external field names

export type HetznerCloudFirewallRule = Readonly<{
	direction: string;
	protocol: string;
	port?: string;
	sourceIps: readonly string[];
}>;

/** Compares effective rules; provider order and descriptions are not state. */
export function isFirewallAsStated(rules: readonly HetznerCloudFirewallRule[]) {
	const stated = hetznerCloudFirewallRules.map(toComparable);
	const held = rules.map(toComparable);
	return (
		stated.length === held.length &&
		stated.every((rule) => held.includes(rule)) &&
		held.every((rule) => stated.includes(rule))
	);
}

function toComparable(
	rule: HetznerCloudFirewallRule | (typeof hetznerCloudFirewallRules)[number],
) {
	const sources =
		"sourceIps" in rule ? [...rule.sourceIps] : [...rule.source_ips];
	const port = "port" in rule ? (rule.port ?? "") : "";
	return `${rule.direction} ${rule.protocol} ${port} ${[...sources].sort().join(",")}`;
}
