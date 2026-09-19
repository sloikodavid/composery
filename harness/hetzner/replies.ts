/**
 * The shapes Hetzner sends, as `contracts/hetzner.json` describes them. Composery reads a few of
 * these fields; the rest are here because Hetzner always sends them, and a fake that sends less
 * would let our code depend on a Hetzner that does not exist. The values are invented; the shape
 * is not, and the fake checks every reply against Hetzner's own description.
 */

// biome-ignore-start lint/style/useNamingConvention: the Hetzner Cloud API names these fields

const created = "2026-09-15T10:00:00+00:00";
const serverTypeId = 22;
const cores = 2;
const memory = 4;
const disk = 40;
const trafficBytes = 1_099_511_627_776;
const firstLocationId = 1;
const latitude = 49.452_102;
const longitude = 11.076_665;
const pricePerHour = "0.0082";
const pricePerMonth = "5.39";
const finishedProgress = 100;

/**
 * What one address looks like inside a server's public network. Hetzner requires `ip` here but
 * not `id`, so a test can leave the number out.
 */
export type ReplyAddress = Readonly<{ id?: number; ip: string }>;

function toPrice(location: string) {
	return {
		location,
		price_hourly: { net: pricePerHour, gross: pricePerHour },
		price_monthly: { net: pricePerMonth, gross: pricePerMonth },
		included_traffic: trafficBytes,
		price_per_tb_traffic: { net: pricePerHour, gross: pricePerHour },
	};
}

export function toLocationReply(name: string, index: number) {
	return {
		id: firstLocationId + index,
		name,
		description: `Location ${name}`,
		country: "DE",
		city: "Nuremberg",
		latitude,
		longitude,
		network_zone: "eu-central",
	};
}

export function toServerTypeReply(name: string, locations: readonly string[]) {
	return {
		id: serverTypeId,
		name,
		description: name.toUpperCase(),
		cores,
		memory,
		disk,
		deprecated: false,
		deprecation: null,
		prices: locations.map(toPrice),
		storage_type: "local",
		cpu_type: "shared",
		architecture: "x86",
		locations: locations.map((location, index) => ({
			...toLocationReply(location, index),
			recommended: index === 0,
			deprecation: null,
			available: true,
		})),
	};
}

export function toImageReply(id: number, name: string) {
	return {
		id,
		type: "system",
		status: "available",
		name,
		description: `Ubuntu ${name}`,
		image_size: null,
		disk_size: disk,
		created,
		created_from: null,
		deleted: null,
		bound_to: null,
		os_flavor: "ubuntu",
		os_version: "24.04",
		rapid_deploy: true,
		protection: { delete: false },
		deprecated: null,
		deprecation: null,
		labels: {},
		architecture: "x86",
	};
}

export function toFirewallReply(
	id: number,
	controllerId: string,
	rules: readonly unknown[] = [],
) {
	return {
		id,
		name: "composery",
		labels: { "controller-id": controllerId },
		created,
		rules,
		applied_to: [],
	};
}

export function toActionReply(id: number, status: string) {
	return {
		id,
		command: "create_server",
		status,
		progress: status === "running" ? 0 : finishedProgress,
		started: created,
		finished: status === "running" ? null : created,
		resources: [],
		error: null,
	};
}

export function toPrimaryIpReply(
	fields: Readonly<{
		id: number;
		name: string;
		labels: Record<string, string>;
		ip: string;
		type: string;
		assigneeId: number | null;
		location: string;
	}>,
) {
	return {
		id: fields.id,
		name: fields.name,
		labels: fields.labels,
		created,
		blocked: false,
		location: toLocationReply(fields.location, 0),
		ip: fields.ip,
		dns_ptr: [],
		protection: { delete: false },
		type: fields.type,
		auto_delete: true,
		assignee_type: "server",
		assignee_id: fields.assigneeId,
	};
}

export function toServerReply(
	fields: Readonly<{
		id: number;
		name: string;
		status: string;
		labels: Record<string, string>;
		/** Null when the server has no address of that kind, as Hetzner reports it. */
		ipv4: ReplyAddress | null;
		ipv6: ReplyAddress | null;
		/** Null leaves the member out, as Hetzner may for a server with no firewall. */
		firewallId: number | null;
		serverType: string;
		location: string;
		imageId: number;
		imageName: string;
	}>,
) {
	return {
		id: fields.id,
		name: fields.name,
		status: fields.status,
		created,
		public_net: {
			ipv4:
				fields.ipv4 === null
					? null
					: { ...fields.ipv4, blocked: false, dns_ptr: fields.ipv4.ip },
			ipv6:
				fields.ipv6 === null
					? null
					: { ...fields.ipv6, blocked: false, dns_ptr: [] },
			floating_ips: [],
			...(fields.firewallId === null
				? {}
				: { firewalls: [{ id: fields.firewallId, status: "applied" }] }),
		},
		private_net: [],
		server_type: toServerTypeReply(fields.serverType, [fields.location]),
		location: toLocationReply(fields.location, 0),
		image: toImageReply(fields.imageId, fields.imageName),
		iso: null,
		rescue_enabled: false,
		locked: false,
		backup_window: null,
		outgoing_traffic: null,
		ingoing_traffic: null,
		included_traffic: trafficBytes,
		protection: { delete: false, rebuild: false },
		labels: fields.labels,
		volumes: [],
		load_balancers: [],
		primary_disk_size: disk,
		placement_group: null,
	};
}

/** One page that holds everything, because a fake never has more than a test made. */
export function toPaginationReply(count: number) {
	return {
		pagination: {
			page: 1,
			per_page: count,
			previous_page: null,
			next_page: null,
			last_page: 1,
			total_entries: count,
		},
	};
}

// biome-ignore-end lint/style/useNamingConvention: the Hetzner Cloud API names these fields
