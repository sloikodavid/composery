"use node";

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import {
	SERVER_LOCATIONS,
	SERVER_TYPES,
	vServerLocation,
	vSnapshotClass,
	type ServerLocation,
	type ServerType
} from "../../schema";
import { optionalEnv, requiredEnv } from "../../env";
import { authorizedPublicKey } from "./sshKeys";

export type PlacementCandidate = {
	serverType: ServerType;
	location: ServerLocation;
};

export function placementCandidates(
	serverTypes: readonly ServerType[] = SERVER_TYPES,
	locations: readonly ServerLocation[] = SERVER_LOCATIONS
) {
	return serverTypes.flatMap((serverType) =>
		locations.map((location) => ({ serverType, location }))
	);
}

function parseAllowedList<const T extends string>(
	value: string | undefined,
	fallback: readonly T[]
) {
	if (!value) return [...fallback];

	const allowed = new Set<string>(fallback);
	const parsed = value
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);

	if (parsed.length === 0) return [...fallback];

	for (const part of parsed) {
		if (!allowed.has(part)) {
			throw new Error(`Unsupported provisioning value: ${part}.`);
		}
	}

	return parsed as T[];
}

export function parseServerTypes(value: string | undefined): ServerType[] {
	return parseAllowedList(value, SERVER_TYPES);
}

export function parseLocations(value: string | undefined): ServerLocation[] {
	return parseAllowedList(value, SERVER_LOCATIONS);
}

type HetznerServer = {
	created?: string;
	datacenter?: { location?: { name?: string } };
	id: number;
	location?: { name?: string };
	name?: string;
	public_net?: {
		ipv4?: { id?: number; ip?: string };
		ipv6?: { id?: number; ip?: string };
	};
	server_type?: { name?: string };
	status?: string;
};

type HetznerPagination = {
	meta?: { pagination?: { next_page?: number | null } };
};

type HetznerAction = {
	error?: { code?: string; message?: string } | null;
	id: number;
	status?: string;
};

type HetznerCreateResponse = {
	server?: HetznerServer;
};

type HetznerListResponse = {
	servers?: HetznerServer[];
};

type HetznerActionResponse = {
	action?: HetznerAction;
};

type HetznerRebuildResponse = {
	action?: HetznerAction;
	root_password?: string | null;
};

type HetznerImage = {
	id: number;
	type?: string;
	status?: string;
	image_size?: number | null;
	disk_size?: number;
	created?: string;
	description?: string;
	labels?: Record<string, string>;
	bound_to?: number | null;
	created_from?: { id?: number; name?: string } | null;
};

export type { HetznerAction, HetznerImage };

type HetznerPrimaryIp = {
	id: number;
	ip?: string;
};

type HetznerCreateImageResponse = {
	action?: HetznerAction;
	image?: HetznerImage;
};

type HetznerImageResponse = {
	image: HetznerImage;
};

type HetznerImagesResponse = {
	images?: HetznerImage[];
};

type HetznerPrimaryIpsResponse = {
	primary_ips?: HetznerPrimaryIp[];
};

export class HetznerApiError extends Error {
	constructor(
		message: string,
		public readonly status: number,
		public readonly code?: string
	) {
		super(message);
		this.name = "HetznerApiError";
	}
}

class HetznerServerCreatedButNotReadyError extends Error {
	constructor(serverId: number, cause: unknown) {
		super(
			cause instanceof Error
				? cause.message
				: `Hetzner server ${serverId} did not become ready.`
		);
		this.name = "HetznerServerCreatedButNotReadyError";
	}
}

function hetznerHeaders() {
	return {
		Authorization: `Bearer ${requiredEnv("HETZNER_CLOUD_TOKEN")}`,
		"Content-Type": "application/json"
	};
}

async function hetznerRequest<T>(path: string, init?: RequestInit) {
	const response = await fetch(`https://api.hetzner.cloud/v1${path}`, {
		...init,
		headers: {
			...hetznerHeaders(),
			...init?.headers
		}
	});
	const text = await response.text();
	type ResponseBody = T & { error?: { code?: string; message?: string } };
	let body: ResponseBody;
	try {
		body = text ? (JSON.parse(text) as ResponseBody) : ({} as ResponseBody);
	} catch {
		// Gateways can answer with non-JSON (HTML error pages); keep the status
		// instead of surfacing a bare SyntaxError.
		body = {} as ResponseBody;
	}

	if (!response.ok) {
		if (body.error?.code === "resource_limit_exceeded") {
			// Hetzner has no quota endpoint, so this 403 is the only signal that the
			// project's server or snapshot limit is full. Log it loudly (the path
			// says whether it was a server create or a create_image) so the limit
			// gets raised; the caller still handles the throw as a normal failure.
			console.warn(
				`[hetzner] resource limit exceeded on ${path}: ${body.error.message ?? ""}`
			);
		}
		throw new HetznerApiError(
			body.error?.message ?? `Hetzner API ${response.status}.`,
			response.status,
			body.error?.code
		);
	}

	return body;
}

function isNotFound(error: unknown) {
	return error instanceof HetznerApiError && error.status === 404;
}

export { isNotFound as isHetznerNotFound };

function isInvalidInput(error: unknown) {
	return (
		error instanceof HetznerApiError &&
		(error.status === 400 || error.status === 422)
	);
}

function normalizeIpv6ForDns(ip: string) {
	return ip.split("/")[0];
}

function splitKeyRefs(value: string | undefined) {
	return (value ?? "")
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

function yamlSingleQuote(value: string) {
	if (/[\r\n]/.test(value)) {
		throw new Error("Cloud-init values must stay on one line.");
	}
	return `'${value.replace(/'/g, "''")}'`;
}

function renderCloudInitUserData() {
	return `#cloud-config
disable_root: false
ssh_pwauth: false
users:
  - name: ${yamlSingleQuote(requiredEnv("SSH_USER"))}
    shell: /bin/bash
    lock_passwd: true
    ssh_authorized_keys:
      - ${yamlSingleQuote(authorizedPublicKey())}
`;
}

export function createServerPayload(
	candidate: PlacementCandidate,
	slug: string
) {
	const sshKeys = splitKeyRefs(requiredEnv("HETZNER_SSH_KEYS"));
	const firewallId = requiredEnv("HETZNER_FIREWALL_ID");
	const networkId = optionalEnv("HETZNER_NETWORK_ID");

	return {
		name: `composery-${slug}`,
		server_type: candidate.serverType,
		image: requiredEnv("HETZNER_BOX_IMAGE"),
		location: candidate.location,
		ssh_keys: sshKeys,
		user_data: renderCloudInitUserData(),
		firewalls: [{ firewall: Number(firewallId) }],
		networks: networkId ? [Number(networkId)] : undefined,
		public_net: {
			enable_ipv4: true,
			enable_ipv6: true
		},
		labels: {
			product: "composery-web",
			box_slug: slug
		}
	};
}

export function rebuildServerPayload(image: number | string) {
	return {
		image,
		user_data: renderCloudInitUserData()
	};
}

export function composeryServerListPath(slug: string) {
	const params = new URLSearchParams({
		label_selector: `product=composery-web,box_slug=${slug}`
	});
	return `/servers?${params.toString()}`;
}

function isServerType(value: string | undefined): value is ServerType {
	return SERVER_TYPES.includes(value as ServerType);
}

function isServerLocation(value: string | undefined): value is ServerLocation {
	return SERVER_LOCATIONS.includes(value as ServerLocation);
}

function serverLocation(server: HetznerServer) {
	return server.datacenter?.location?.name ?? server.location?.name;
}

function materializeServer(
	server: HetznerServer,
	fallback?: PlacementCandidate
) {
	const ipv4 = server.public_net?.ipv4?.ip;
	const ipv6 = server.public_net?.ipv6?.ip;

	if (!ipv4 || !ipv6) {
		throw new Error("Hetzner server is missing public IPv4 or IPv6.");
	}

	const apiServerType = server.server_type?.name;
	const apiLocation = serverLocation(server);
	const serverType = isServerType(apiServerType)
		? apiServerType
		: fallback?.serverType;
	const location = isServerLocation(apiLocation)
		? apiLocation
		: fallback?.location;

	if (!serverType || !location) {
		throw new Error("Hetzner server returned unsupported type or location.");
	}

	return {
		serverId: server.id,
		serverType,
		location,
		ipv4,
		ipv4Id: server.public_net?.ipv4?.id,
		ipv6: normalizeIpv6ForDns(ipv6),
		ipv6Id: server.public_net?.ipv6?.id
	};
}

async function findExistingServer(slug: string) {
	const response = await hetznerRequest<HetznerListResponse>(
		composeryServerListPath(slug)
	);
	const servers = response.servers ?? [];

	return (
		servers.find(
			(server) =>
				server.status === "running" &&
				server.public_net?.ipv4?.ip &&
				server.public_net?.ipv6?.ip
		) ??
		servers.find((server) => server.id) ??
		null
	);
}

async function existingCreatedServer(
	slug: string,
	fallback: PlacementCandidate
) {
	const existing = await findExistingServer(slug);
	if (!existing) return null;
	const ready = await waitForServer(existing.id);
	return materializeServer(ready, fallback);
}

async function waitForServer(serverId: number) {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		const response = await hetznerRequest<{ server: HetznerServer }>(
			`/servers/${serverId}`
		);

		if (
			response.server.status === "running" &&
			response.server.public_net?.ipv4?.ip &&
			response.server.public_net?.ipv6?.ip
		) {
			return response.server;
		}

		await new Promise((resolve) => setTimeout(resolve, 3000));
	}

	throw new Error(`Hetzner server ${serverId} did not become ready.`);
}

async function waitForActionSuccess(actionId: number) {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const response = await hetznerRequest<HetznerActionResponse>(
			`/actions/${actionId}`
		);
		const action = response.action;

		if (action?.status === "success") return;
		if (action?.status === "error") {
			throw new Error(
				action.error?.message ?? `Hetzner action ${actionId} failed.`
			);
		}

		await new Promise((resolve) => setTimeout(resolve, 3000));
	}

	throw new Error(`Hetzner action ${actionId} did not finish in time.`);
}

async function createHetznerServer(
	candidate: PlacementCandidate,
	slug: string
) {
	let createdServerId: number | undefined;

	try {
		const response = await hetznerRequest<HetznerCreateResponse>("/servers", {
			method: "POST",
			body: JSON.stringify(createServerPayload(candidate, slug))
		});

		if (!response.server?.id) {
			throw new Error("Hetzner did not return a server id.");
		}

		createdServerId = response.server.id;
		const server = await waitForServer(response.server.id);
		return materializeServer(server, candidate);
	} catch (error) {
		if (createdServerId) {
			throw new HetznerServerCreatedButNotReadyError(createdServerId, error);
		}
		throw error;
	}
}

type HetznerMetricsResponse = {
	metrics?: {
		time_series?: Record<string, { values?: [number, string][] }>;
	};
};

function seriesMean(
	timeSeries: Record<string, { values?: [number, string][] }>,
	name: string
) {
	const values = (timeSeries[name]?.values ?? [])
		.map(([, value]) => Number(value))
		.filter(Number.isFinite);
	if (values.length === 0) return 0;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function fetchServerMetricsSample(
	serverId: number,
	windowMs: number
) {
	const end = new Date();
	const start = new Date(end.getTime() - windowMs);
	const params = new URLSearchParams({
		type: "cpu,disk,network",
		start: start.toISOString(),
		end: end.toISOString(),
		step: "60"
	});
	const response = await hetznerRequest<HetznerMetricsResponse>(
		`/servers/${serverId}/metrics?${params.toString()}`
	);
	const timeSeries = response.metrics?.time_series ?? {};

	return {
		cpuPercent: seriesMean(timeSeries, "cpu"),
		ingressBps: seriesMean(timeSeries, "network.0.bandwidth.in"),
		egressBps: seriesMean(timeSeries, "network.0.bandwidth.out"),
		ingressPps: seriesMean(timeSeries, "network.0.pps.in"),
		egressPps: seriesMean(timeSeries, "network.0.pps.out"),
		diskReadBps: seriesMean(timeSeries, "disk.0.bandwidth.read"),
		diskWriteBps: seriesMean(timeSeries, "disk.0.bandwidth.write")
	};
}

export const createServer = internalAction({
	args: {
		boxId: v.id("boxes"),
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const serverTypes = parseServerTypes(process.env.HETZNER_BOX_SERVER_TYPES);
		const locations = parseLocations(process.env.HETZNER_BOX_LOCATIONS);
		const candidates = placementCandidates(serverTypes, locations);
		let lastError: string | undefined;
		const fallbackCandidate = candidates[0];

		if (!fallbackCandidate) {
			throw new Error("No Hetzner placement candidates configured.");
		}

		const existing = await existingCreatedServer(args.slug, fallbackCandidate);
		if (existing) return existing;

		for (const candidate of candidates) {
			try {
				return await createHetznerServer(candidate, args.slug);
			} catch (error) {
				if (error instanceof HetznerServerCreatedButNotReadyError) {
					throw error;
				}
				// Account quota is independent of server type and location. Trying the
				// full placement matrix cannot make it pass; let the workflow retry and
				// eventually apply the paid-but-unfulfilled refund path.
				if (
					error instanceof HetznerApiError &&
					error.code === "resource_limit_exceeded"
				) {
					// The provider has authoritatively said another server cannot be
					// created. Stop new payable checkouts so repeated purchases do not
					// become repeated refunds and non-refundable Polar fees. Staff can
					// request the Hetzner increase and re-enable checkout in the console.
					await ctx.runMutation(internal.settings.setCheckoutEnabled, {
						checkoutEnabled: false,
						updatedBy: "system:hetzner_resource_limit_exceeded"
					});
					throw error;
				}

				const recovered = await existingCreatedServer(args.slug, candidate);
				if (recovered) return recovered;
				lastError = error instanceof Error ? error.message : String(error);
			}
		}

		throw new Error(lastError ?? "No Hetzner placement candidate succeeded.");
	}
});

export const rebuildServer = internalAction({
	args: {
		serverId: v.optional(v.number()),
		image: v.optional(v.union(v.number(), v.string()))
	},
	handler: async (ctx, args) => {
		if (!args.serverId) {
			throw new Error("Box has no Hetzner server to rebuild.");
		}

		const image = args.image ?? requiredEnv("HETZNER_BOX_IMAGE");

		const response = await hetznerRequest<HetznerRebuildResponse>(
			`/servers/${args.serverId}/actions/rebuild`,
			{
				method: "POST",
				// Always send the current key. Hetzner supports user_data on rebuilds,
				// including snapshot restores; relying only on the key selected when the
				// server was created would make credential rotation ineffective here.
				body: JSON.stringify(rebuildServerPayload(image))
			}
		);

		if (!response.action?.id) {
			throw new Error("Hetzner rebuild did not return an action id.");
		}

		await waitForActionSuccess(response.action.id);
		return materializeServer(await waitForServer(args.serverId));
	}
});

export const deleteServer = internalAction({
	args: {
		serverId: v.optional(v.number())
	},
	handler: async (_ctx, args) => {
		if (!args.serverId) return;

		try {
			await hetznerRequest(`/servers/${args.serverId}`, {
				method: "DELETE"
			});
		} catch (error) {
			if (!isNotFound(error)) throw error;
		}
	}
});

export function primaryIpListPath(ip: string) {
	const params = new URLSearchParams({ ip });
	return `/primary_ips?${params.toString()}`;
}

export function primaryIpLookupAddresses(address: string) {
	const normalized = normalizeIpv6ForDns(address);
	if (!address.includes(":")) return [address];
	if (address.includes("/")) return [...new Set([address, normalized])];
	return [...new Set([address, `${normalized}/64`])];
}

export function primaryIpMatchesAddress(
	primaryIp: { ip?: string },
	address: string
) {
	if (!primaryIp.ip) return false;
	return (
		primaryIp.ip === address ||
		normalizeIpv6ForDns(primaryIp.ip) === normalizeIpv6ForDns(address)
	);
}

export async function findPrimaryIpByAddress(ip: string) {
	for (const address of primaryIpLookupAddresses(ip)) {
		let response: HetznerPrimaryIpsResponse;
		try {
			response = await hetznerRequest<HetznerPrimaryIpsResponse>(
				primaryIpListPath(address)
			);
		} catch (error) {
			// Hetzner rejects some lookup forms with "invalid input in field 'ip'"
			// (seen with the `<address>/64` IPv6 form). A value the API cannot
			// parse cannot name an existing Primary IP, so skip it - throwing here
			// wedged box deletion permanently, retried by every hourly sweep.
			if (isInvalidInput(error)) continue;
			throw error;
		}
		const primaryIp = (response.primary_ips ?? []).find((candidate) =>
			primaryIpMatchesAddress(candidate, ip)
		);
		if (primaryIp) return primaryIp;
	}
	return undefined;
}

async function deletePrimaryIp(primaryIpId: number) {
	try {
		await hetznerRequest(`/primary_ips/${primaryIpId}`, { method: "DELETE" });
		return true;
	} catch (error) {
		if (!isNotFound(error)) throw error;
		return false;
	}
}

async function deletePrimaryIpByIdOrAddress(
	id: number | undefined,
	address: string | undefined
) {
	if (id !== undefined) {
		const deleted = await deletePrimaryIp(id);
		if (deleted) return;
	}

	if (!address) return;
	const primaryIp = await findPrimaryIpByAddress(address);
	if (primaryIp) await deletePrimaryIp(primaryIp.id);
}

export const deletePrimaryIps = internalAction({
	args: {
		ipv4: v.optional(v.string()),
		ipv4Id: v.optional(v.number()),
		ipv6: v.optional(v.string()),
		ipv6Id: v.optional(v.number())
	},
	handler: async (_ctx, args) => {
		await deletePrimaryIpByIdOrAddress(args.ipv4Id, args.ipv4);
		await deletePrimaryIpByIdOrAddress(args.ipv6Id, args.ipv6);
	}
});

async function waitForServerGone(serverId: number) {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		try {
			await hetznerRequest<{ server: HetznerServer }>(`/servers/${serverId}`);
		} catch (error) {
			if (isNotFound(error)) return;
			throw error;
		}
		await new Promise((resolve) => setTimeout(resolve, 3000));
	}

	throw new Error(`Hetzner server ${serverId} was not deleted in time.`);
}

export const waitServerDeleted = internalAction({
	args: {
		serverId: v.optional(v.number())
	},
	handler: async (_ctx, args) => {
		if (!args.serverId) return;
		await waitForServerGone(args.serverId);
	}
});

async function serverStatus(serverId: number) {
	const response = await hetznerRequest<{ server: HetznerServer }>(
		`/servers/${serverId}`
	);
	return response.server.status;
}

async function waitForServerOff(serverId: number) {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		if ((await serverStatus(serverId)) === "off") return true;
		await new Promise((resolve) => setTimeout(resolve, 3000));
	}
	return false;
}

export const powerOffServer = internalAction({
	args: {
		serverId: v.optional(v.number())
	},
	handler: async (_ctx, args) => {
		if (!args.serverId) return;
		if ((await serverStatus(args.serverId)) === "off") return;
		await hetznerRequest(`/servers/${args.serverId}/actions/poweroff`, {
			method: "POST"
		});
	}
});

export const stopServer = internalAction({
	args: {
		serverId: v.optional(v.number())
	},
	handler: async (_ctx, args) => {
		if (!args.serverId) return;
		if ((await serverStatus(args.serverId)) === "off") return;

		await hetznerRequest(`/servers/${args.serverId}/actions/shutdown`, {
			method: "POST"
		});
		if (await waitForServerOff(args.serverId)) return;

		await hetznerRequest(`/servers/${args.serverId}/actions/poweroff`, {
			method: "POST"
		});
		if (!(await waitForServerOff(args.serverId))) {
			throw new Error(`Hetzner server ${args.serverId} did not power off.`);
		}
	}
});

export const powerOnServer = internalAction({
	args: {
		serverId: v.optional(v.number())
	},
	handler: async (_ctx, args) => {
		if (!args.serverId) return;
		await hetznerRequest(`/servers/${args.serverId}/actions/poweron`, {
			method: "POST"
		});
	}
});

export function snapshotImageListPath(slug: string) {
	const params = new URLSearchParams({
		type: "snapshot",
		label_selector: `product=composery-web,box_slug=${slug}`
	});
	return `/images?${params.toString()}`;
}

export function createSnapshotImagePayload(slug: string, description: string) {
	return {
		type: "snapshot" as const,
		description,
		labels: { product: "composery-web", box_slug: slug }
	};
}

export function parseCreateImageResponse(body: HetznerCreateImageResponse): {
	actionId: number;
	imageId: number;
} {
	if (!body.action?.id || !body.image?.id) {
		throw new Error(
			"Hetzner create_image did not return an action and image id."
		);
	}
	return { actionId: body.action.id, imageId: body.image.id };
}

// Unknown action statuses are treated as `running` so a transient new status
// does not abort an in-progress snapshot.
export function parseActionStatus(action: HetznerAction): {
	status: "running" | "success" | "error";
	error?: string;
} {
	if (action.status === "success") return { status: "success" };
	if (action.status === "error") {
		return {
			status: "error",
			error: action.error?.message ?? "Hetzner action failed."
		};
	}
	return { status: "running" };
}

// `image_size` is null until the image is `available`, so `imageSizeGb` stays
// optional.
export function parseImageResponse(image: HetznerImage): {
	status: "creating" | "available";
	imageSizeGb?: number;
} {
	return {
		status: image.status === "available" ? "available" : "creating",
		imageSizeGb: image.image_size ?? undefined
	};
}

export const createSnapshotImage = internalAction({
	args: {
		serverId: v.optional(v.number()),
		slug: v.string(),
		snapshotClass: vSnapshotClass
	},
	returns: v.object({
		actionId: v.number(),
		imageId: v.number()
	}),
	handler: async (ctx, args) => {
		if (!args.serverId) {
			throw new Error("Box has no Hetzner server to snapshot.");
		}

		// The timestamped description is built here rather than in the workflow
		// handler, which must stay deterministic across replays.
		const description = `composery-web ${args.slug} ${args.snapshotClass} ${new Date().toISOString()}`;
		let response: HetznerCreateImageResponse;
		try {
			response = await hetznerRequest<HetznerCreateImageResponse>(
				`/servers/${args.serverId}/actions/create_image`,
				{
					method: "POST",
					body: JSON.stringify(
						createSnapshotImagePayload(args.slug, description)
					)
				}
			);
		} catch (error) {
			if (
				error instanceof HetznerApiError &&
				error.code === "resource_limit_exceeded"
			) {
				await ctx.runMutation(internal.settings.setCheckoutEnabled, {
					checkoutEnabled: false,
					updatedBy: "system:hetzner_snapshot_resource_limit_exceeded"
				});
			}
			throw error;
		}

		return parseCreateImageResponse(response);
	}
});

export const getAction = internalAction({
	args: { actionId: v.number() },
	returns: v.object({
		status: v.union(
			v.literal("running"),
			v.literal("success"),
			v.literal("error")
		),
		error: v.optional(v.string())
	}),
	handler: async (_ctx, args) => {
		const response = await hetznerRequest<HetznerActionResponse>(
			`/actions/${args.actionId}`
		);
		if (!response.action) {
			throw new Error(`Hetzner action ${args.actionId} not found.`);
		}
		return parseActionStatus(response.action);
	}
});

export const getImage = internalAction({
	args: { imageId: v.number() },
	returns: v.object({
		status: v.union(v.literal("creating"), v.literal("available")),
		imageSizeGb: v.optional(v.number())
	}),
	handler: async (_ctx, args) => {
		const response = await hetznerRequest<HetznerImageResponse>(
			`/images/${args.imageId}`
		);
		return parseImageResponse(response.image);
	}
});

export const listSnapshotImages = internalAction({
	args: { slug: v.string() },
	returns: v.array(
		v.object({
			imageId: v.number(),
			status: v.string(),
			imageSizeGb: v.optional(v.number())
		})
	),
	handler: async (_ctx, args) => {
		const response = await hetznerRequest<HetznerImagesResponse>(
			snapshotImageListPath(args.slug)
		);
		return (response.images ?? []).map((image) => ({
			imageId: image.id,
			status: image.status ?? "creating",
			imageSizeGb: image.image_size ?? undefined
		}));
	}
});

// `created` is always present on Hetzner resources; fall back to "now" so an
// unparseable timestamp is treated as freshly created and skipped by the
// reconciliation age guard rather than risking deletion of something we can't
// date.
function parseCreatedMs(created: string | undefined) {
	const parsed = created ? Date.parse(created) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : Date.now();
}

function productImageListPath(page: number) {
	const params = new URLSearchParams({
		type: "snapshot",
		label_selector: "product=composery-web",
		per_page: "50",
		page: String(page)
	});
	return `/images?${params.toString()}`;
}

function productServerListPath(page: number) {
	const params = new URLSearchParams({
		label_selector: "product=composery-web",
		per_page: "50",
		page: String(page)
	});
	return `/servers?${params.toString()}`;
}

// Reconciliation feed: every snapshot image we own, fleet-wide, so the cron can
// delete any whose box_snapshots row is gone.
export const listProductSnapshotImages = internalAction({
	args: {},
	returns: v.array(v.object({ imageId: v.number(), createdAtMs: v.number() })),
	handler: async () => {
		const images: { imageId: number; createdAtMs: number }[] = [];
		let page: number | null = 1;
		while (page) {
			const body: HetznerImagesResponse & HetznerPagination =
				await hetznerRequest<HetznerImagesResponse & HetznerPagination>(
					productImageListPath(page)
				);
			for (const image of body.images ?? []) {
				images.push({
					imageId: image.id,
					createdAtMs: parseCreatedMs(image.created)
				});
			}
			page = body.meta?.pagination?.next_page ?? null;
		}
		return images;
	}
});

// Reconciliation feed: every server we own, fleet-wide, so the cron can flag any
// with no live box pointing at it.
export const listProductServers = internalAction({
	args: {},
	returns: v.array(
		v.object({
			serverId: v.number(),
			name: v.optional(v.string()),
			createdAtMs: v.number()
		})
	),
	handler: async () => {
		const servers: {
			serverId: number;
			name?: string;
			createdAtMs: number;
		}[] = [];
		let page: number | null = 1;
		while (page) {
			const body: HetznerListResponse & HetznerPagination =
				await hetznerRequest<HetznerListResponse & HetznerPagination>(
					productServerListPath(page)
				);
			for (const server of body.servers ?? []) {
				servers.push({
					serverId: server.id,
					name: server.name,
					createdAtMs: parseCreatedMs(server.created)
				});
			}
			page = body.meta?.pagination?.next_page ?? null;
		}
		return servers;
	}
});

export const deleteImage = internalAction({
	args: { imageId: v.optional(v.number()) },
	handler: async (_ctx, args) => {
		if (!args.imageId) return;
		try {
			await hetznerRequest(`/images/${args.imageId}`, { method: "DELETE" });
		} catch (error) {
			if (!isNotFound(error)) throw error;
		}
	}
});

export type CreatedServer = {
	ipv4: string;
	ipv4Id?: number;
	ipv6: string;
	ipv6Id?: number;
	location: ServerLocation;
	serverId: number;
	serverType: ServerType;
};

// -- Parking volumes (Rebuild) ----------------------------------------------
//
// A Rebuild ("clean host, current files") parks the box's files on a Hetzner
// Volume for the few minutes it takes to wipe and reboot the server from the
// base image. The Volume is transient by design: Hetzner gives Volumes no
// backups or snapshots and excludes attached volumes from server snapshots, so
// they are never a permanent home for box data - only a short-lived staging
// area, created at the start of a rebuild and deleted the moment the files are
// safely back on the fresh host.

type HetznerVolume = {
	id: number;
	name?: string;
	size?: number;
	location?: { name?: string };
	server?: number | null;
	linux_device?: string;
	status?: string;
	created?: string;
	labels?: Record<string, string>;
};

type HetznerVolumeResponse = { volume: HetznerVolume };
type HetznerVolumesResponse = { volumes?: HetznerVolume[] };
type HetznerCreateVolumeResponse = {
	volume?: HetznerVolume;
	action?: HetznerAction;
	next_actions?: HetznerAction[];
};

// Hetzner Volume minimum is 10 GB and the size must be a whole number of GB.
export const PARKING_VOLUME_MIN_GB = 10;
// The copied delta needs slack for the destination filesystem's own metadata and
// for growth between measuring and copying; under-sizing only fails the copy
// (before anything destructive), so erring large is the safe direction.
const PARKING_VOLUME_HEADROOM_FACTOR = 1.2;
const PARKING_VOLUME_HEADROOM_GB = 3;

export function parkingVolumeSizeGb(usedBytes: number) {
	if (!Number.isFinite(usedBytes) || usedBytes < 0) {
		throw new Error("Cannot size a parking volume from an unmeasured usage.");
	}
	const gb =
		Math.ceil((usedBytes * PARKING_VOLUME_HEADROOM_FACTOR) / 1e9) +
		PARKING_VOLUME_HEADROOM_GB;
	return Math.max(PARKING_VOLUME_MIN_GB, gb);
}

export function parkingVolumeName(slug: string) {
	return `composery-park-${slug}`;
}

// Hetzner exposes an attached Volume at a stable, id-derived path, so the box
// scripts never have to guess a `/dev/sd*` letter that can shift between boots.
export function parkingVolumeDevicePath(volumeId: number) {
	return `/dev/disk/by-id/scsi-0HC_Volume_${volumeId}`;
}

export function createVolumePayload(
	slug: string,
	location: ServerLocation,
	sizeGb: number
) {
	return {
		name: parkingVolumeName(slug),
		size: sizeGb,
		location,
		// Pre-format so the box only ever has to mount it; formatting on the host
		// would risk a resumed rebuild reformatting a volume that already holds the
		// parked files.
		format: "ext4" as const,
		automount: false,
		labels: { product: "composery-web", box_slug: slug, role: "parking" }
	};
}

export function attachVolumePayload(serverId: number) {
	// automount:false - the box scripts mount it deliberately at a known path.
	return { server: serverId, automount: false };
}

export function productVolumeListPath(page: number) {
	const params = new URLSearchParams({
		label_selector: "product=composery-web,role=parking",
		per_page: "50",
		page: String(page)
	});
	return `/volumes?${params.toString()}`;
}

async function waitForVolumeActions(actions: (HetznerAction | undefined)[]) {
	for (const action of actions) {
		if (action?.id) await waitForActionSuccess(action.id);
	}
}

async function getVolume(volumeId: number) {
	const response = await hetznerRequest<HetznerVolumeResponse>(
		`/volumes/${volumeId}`
	);
	return response.volume;
}

export const createParkingVolume = internalAction({
	args: {
		slug: v.string(),
		location: vServerLocation,
		usedBytes: v.number()
	},
	returns: v.object({ volumeId: v.number(), sizeGb: v.number() }),
	handler: async (_ctx, args) => {
		const sizeGb = parkingVolumeSizeGb(args.usedBytes);
		const response = await hetznerRequest<HetznerCreateVolumeResponse>(
			"/volumes",
			{
				method: "POST",
				body: JSON.stringify(createVolumePayload(args.slug, args.location, sizeGb))
			}
		);
		if (!response.volume?.id) {
			throw new Error("Hetzner did not return a volume id.");
		}
		// Wait for create and the format that rides on it, so the box can mount the
		// volume straight away.
		await waitForVolumeActions([
			response.action,
			...(response.next_actions ?? [])
		]);
		return { volumeId: response.volume.id, sizeGb };
	}
});

export const attachParkingVolume = internalAction({
	args: {
		volumeId: v.number(),
		serverId: v.optional(v.number())
	},
	handler: async (_ctx, args) => {
		if (!args.serverId) {
			throw new Error("Box has no Hetzner server to attach the volume to.");
		}
		const volume = await getVolume(args.volumeId);
		// Idempotent: a resumed rebuild may find it already on this server.
		if (volume.server === args.serverId) return;

		const response = await hetznerRequest<HetznerActionResponse>(
			`/volumes/${args.volumeId}/actions/attach`,
			{
				method: "POST",
				body: JSON.stringify(attachVolumePayload(args.serverId))
			}
		);
		await waitForVolumeActions([response.action]);
	}
});

export const detachParkingVolume = internalAction({
	args: { volumeId: v.number() },
	handler: async (_ctx, args) => {
		let volume: HetznerVolume;
		try {
			volume = await getVolume(args.volumeId);
		} catch (error) {
			if (isNotFound(error)) return;
			throw error;
		}
		// Idempotent: nothing to do if it is already detached.
		if (!volume.server) return;

		const response = await hetznerRequest<HetznerActionResponse>(
			`/volumes/${args.volumeId}/actions/detach`,
			{ method: "POST" }
		);
		await waitForVolumeActions([response.action]);
	}
});

export const deleteParkingVolume = internalAction({
	args: { volumeId: v.number() },
	handler: async (_ctx, args) => {
		let volume: HetznerVolume;
		try {
			volume = await getVolume(args.volumeId);
		} catch (error) {
			if (isNotFound(error)) return;
			throw error;
		}
		// Hetzner refuses to delete an attached volume, so detach first (the server
		// may already be gone, in which case it is detached anyway).
		if (volume.server) {
			const response = await hetznerRequest<HetznerActionResponse>(
				`/volumes/${args.volumeId}/actions/detach`,
				{ method: "POST" }
			);
			await waitForVolumeActions([response.action]);
		}
		try {
			await hetznerRequest(`/volumes/${args.volumeId}`, { method: "DELETE" });
		} catch (error) {
			if (!isNotFound(error)) throw error;
		}
	}
});

// Reconciliation feed: every parking volume we own, fleet-wide, so the cron can
// delete any that no live box still points at.
export const listProductVolumes = internalAction({
	args: {},
	returns: v.array(v.object({ volumeId: v.number(), createdAtMs: v.number() })),
	handler: async () => {
		const volumes: { volumeId: number; createdAtMs: number }[] = [];
		let page: number | null = 1;
		while (page) {
			const body: HetznerVolumesResponse & HetznerPagination =
				await hetznerRequest<HetznerVolumesResponse & HetznerPagination>(
					productVolumeListPath(page)
				);
			for (const volume of body.volumes ?? []) {
				volumes.push({
					volumeId: volume.id,
					createdAtMs: parseCreatedMs(volume.created)
				});
			}
			page = body.meta?.pagination?.next_page ?? null;
		}
		return volumes;
	}
});
