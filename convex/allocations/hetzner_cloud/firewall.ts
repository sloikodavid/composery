/**
 * What every server Composery makes is protected by, stated here rather than in a console. The
 * rules are the product's, not a project's: a deployment that makes servers makes them the same
 * way, and a reader can see what a customer's server allows without an account at the provider.
 *
 * Inbound is closed except for what a customer's own server needs to be reachable at all, and
 * outbound is left alone: Hetzner applies no outbound rules unless some are given, and a server
 * that cannot reach the internet cannot install anything or report its host key.
 */

// biome-ignore-start lint/style/useNamingConvention: the Hetzner Cloud API names these fields
const anySource = ["0.0.0.0/0", "::/0"];

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
// biome-ignore-end lint/style/useNamingConvention: the Hetzner Cloud API names these fields

export type HetznerCloudFirewallRule = Readonly<{
	direction: string;
	protocol: string;
	port?: string;
	sourceIps: readonly string[];
}>;

/**
 * Whether a firewall allows exactly what Composery says it should. Order is not part of it, and
 * neither is the description Hetzner keeps beside each rule: what matters is what passes.
 */
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
