"use node";

import { v } from "convex/values";
import type { z } from "zod";
import { internal } from "../../_generated/api";
import { internalAction } from "../../_generated/server";
import {
	SERVER_LOCATIONS,
	vServerLocation,
	vServerType,
	vSnapshotClass,
	type ServerLocation
} from "../../schema";
import { SERVER_TYPES, type ServerType } from "../../model/box/plan";
import { optionalEnv, requiredEnv } from "../../env";
import {
	hetznerActionResponseSchema,
	hetznerCreateImageResponseSchema,
	hetznerCreateServerResponseSchema,
	hetznerCreateVolumeResponseSchema,
	hetznerImageResponseSchema,
	hetznerImagesResponseSchema,
	hetznerMetricsResponseSchema,
	hetznerPagedImageSummariesResponseSchema,
	hetznerPagedPrimaryIpsResponseSchema,
	hetznerPagedServerSummariesResponseSchema,
	hetznerPagedVolumeSummariesResponseSchema,
	hetznerRebuildResponseSchema,
	hetznerServerListResponseSchema,
	hetznerServerResponseSchema,
	hetznerVolumeResponseSchema,
	type HetznerAction,
	type HetznerImage,
	type HetznerServer
} from "./hetznerContracts";
import { decodeProviderResponse } from "./providerResponse";
import { authorizedPublicKey } from "./sshKeys";

export type PlacementCandidate = {
	serverType: ServerType;
	location: ServerLocation;
};

// Where to try putting a box, in preference order. The server type is not a
// choice here: it is the box's plan, and a box provisioned on a type other than
// the one its plan advertises would be selling a machine it does not run. Only
// the location varies, so a region with no capacity right now falls through to
// the next one.
// How long each poll is willing to wait, as attempts three seconds apart.
//
// Named rather than inline because they are tuning, not behaviour: what a test
// pins is that the wait ends and says which resource it gave up on, and it reads
// the ceiling from here so a retune moves the test with the code instead of
// failing it. Exported for that and for nothing else.
export const HETZNER_POLL_INTERVAL_MS = 3000;
// A server reports "running" within a minute or two of a create.
export const HETZNER_SERVER_POLL_ATTEMPTS = 30;
// Actions cover volume formats and image captures, which take longer.
export const HETZNER_ACTION_POLL_ATTEMPTS = 60;

export function placementCandidates(
	serverType: ServerType,
	locations: readonly ServerLocation[] = SERVER_LOCATIONS
): [PlacementCandidate, ...PlacementCandidate[]] {
	const [first, ...rest] = locations;
	if (!first) throw new Error("No Hetzner placement candidates configured.");
	return [first, ...rest].map((location) => ({
		serverType,
		location
	})) as [PlacementCandidate, ...PlacementCandidate[]];
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

export function parseLocations(value: string | undefined): ServerLocation[] {
	return parseAllowedList(value, SERVER_LOCATIONS);
}

export type { HetznerAction, HetznerImage };

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

function hetznerError(body: unknown) {
	if (!body || typeof body !== "object" || !("error" in body)) return undefined;
	const error = body.error;
	if (!error || typeof error !== "object") return undefined;
	return {
		code:
			"code" in error && typeof error.code === "string"
				? error.code
				: undefined,
		message:
			"message" in error && typeof error.message === "string"
				? error.message
				: undefined
	};
}

async function hetznerRequest<Schema extends z.ZodType>(
	path: string,
	schema: Schema,
	init?: RequestInit
): Promise<z.output<Schema>>;
async function hetznerRequest(
	path: string,
	schema: undefined,
	init?: RequestInit
): Promise<void>;
async function hetznerRequest(
	path: string,
	schema: z.ZodType | undefined,
	init?: RequestInit
) {
	const response = await fetch(`https://api.hetzner.cloud/v1${path}`, {
		...init,
		headers: {
			...hetznerHeaders(),
			...init?.headers
		}
	});
	const text = await response.text();
	let body: unknown = {};
	try {
		body = text ? JSON.parse(text) : {};
	} catch {
		// Gateways can answer with non-JSON (HTML error pages); keep the status
		// instead of surfacing a bare SyntaxError.
	}

	if (!response.ok) {
		const error = hetznerError(body);
		if (error?.code === "resource_limit_exceeded") {
			// Hetzner has no quota endpoint, so this 403 is the only signal that the
			// project's server or snapshot limit is full. Log it loudly (the path
			// says whether it was a server create or a create_image) so the limit
			// gets raised; the caller still handles the throw as a normal failure.
			console.warn(
				`[hetzner] resource limit exceeded on ${path}: ${error.message ?? ""}`
			);
		}
		throw new HetznerApiError(
			error?.message ?? `Hetzner API ${response.status}.`,
			response.status,
			error?.code
		);
	}

	return schema ? decodeProviderResponse("Hetzner", schema, body) : undefined;
}

function isNotFound(error: unknown) {
	return error instanceof HetznerApiError && error.status === 404;
}

export { isNotFound as isHetznerNotFound };

// Hetzner reports a box's IPv6 as the /64 it owns; a DNS AAAA record takes an
// address. Publishing the prefix verbatim is a record no resolver can answer.
export function normalizeIpv6ForDns(ip: string) {
	return ip.split("/")[0];
}

// Hetzner accepts an SSH key by numeric id or by name, in one comma-separated
// variable, so a purely numeric entry is sent as a number and everything else as
// the name it is.
export function splitKeyRefs(value: string | undefined) {
	return (value ?? "")
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

// The one escaping boundary in this file. `renderCloudInitUserData` interpolates
// two operator-set values into a YAML document that becomes the first thing a
// fresh host runs as root, so a value carrying a newline is refused rather than
// escaped: single quotes cannot span lines in YAML, and there is no correct
// reading of an `SSH_USER` that contains one.
export function yamlSingleQuote(value: string) {
	if (/[\r\n]/.test(value)) {
		throw new Error("Cloud-init values must stay on one line.");
	}
	return `'${value.replace(/'/g, "''")}'`;
}

export function renderCloudInitUserData() {
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

	return {
		name: `composery-${slug}`,
		server_type: candidate.serverType,
		image: requiredEnv("HETZNER_BOX_IMAGE"),
		location: candidate.location,
		ssh_keys: sshKeys,
		user_data: renderCloudInitUserData(),
		// No private network: Hetzner firewalls do not filter private network
		// traffic, so a shared network would let one box reach another.
		firewalls: [{ firewall: Number(firewallId) }],
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
	return server.location.name;
}

function responseServer(
	response: z.output<typeof hetznerServerResponseSchema>,
	serverId: number
) {
	if (!response.server) {
		throw new Error(`Hetzner did not return server ${serverId}.`);
	}
	return response.server;
}

// One Hetzner server response turned into the fields the box row keeps.
//
// The provider's answer is authoritative. A type or location outside our own
// unions is rejected instead of being replaced with what the request asked for.
// Missing addresses are fatal because the box needs both DNS records.
export function materializeServer(server: HetznerServer) {
	const ipv4 = server.public_net.ipv4?.ip;
	const ipv6 = server.public_net.ipv6?.ip;

	if (!ipv4 || !ipv6) {
		throw new Error("Hetzner server is missing public IPv4 or IPv6.");
	}

	const apiServerType = server.server_type?.name;
	const apiLocation = serverLocation(server);
	if (!isServerType(apiServerType) || !isServerLocation(apiLocation)) {
		throw new Error("Hetzner server returned unsupported type or location.");
	}

	return {
		serverId: server.id,
		serverType: apiServerType,
		location: apiLocation,
		ipv4,
		ipv6: normalizeIpv6ForDns(ipv6)
	};
}

async function findExistingServer(slug: string) {
	const response = await hetznerRequest(
		composeryServerListPath(slug),
		hetznerServerListResponseSchema
	);
	const servers = response.servers;

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

async function existingCreatedServer(slug: string) {
	const existing = await findExistingServer(slug);
	if (!existing) return null;
	const ready = await waitForServer(existing.id);
	return materializeServer(ready);
}

async function waitForServer(serverId: number) {
	for (let attempt = 0; attempt < HETZNER_SERVER_POLL_ATTEMPTS; attempt += 1) {
		const response = await hetznerRequest(
			`/servers/${serverId}`,
			hetznerServerResponseSchema
		);
		const server = responseServer(response, serverId);

		if (
			server.status === "running" &&
			server.public_net.ipv4?.ip &&
			server.public_net.ipv6?.ip
		) {
			return server;
		}

		await new Promise((resolve) =>
			setTimeout(resolve, HETZNER_POLL_INTERVAL_MS)
		);
	}

	throw new Error(`Hetzner server ${serverId} did not become ready.`);
}

async function waitForActionSuccess(actionId: number) {
	for (let attempt = 0; attempt < HETZNER_ACTION_POLL_ATTEMPTS; attempt += 1) {
		const response = await hetznerRequest(
			`/actions/${actionId}`,
			hetznerActionResponseSchema
		);
		const action = response.action;

		if (action?.status === "success") return;
		if (action?.status === "error") {
			throw new Error(
				action.error?.message ?? `Hetzner action ${actionId} failed.`
			);
		}

		await new Promise((resolve) =>
			setTimeout(resolve, HETZNER_POLL_INTERVAL_MS)
		);
	}

	throw new Error(`Hetzner action ${actionId} did not finish in time.`);
}

async function createHetznerServer(
	candidate: PlacementCandidate,
	slug: string
) {
	let createdServerId: number | undefined;

	try {
		const response = await hetznerRequest(
			"/servers",
			hetznerCreateServerResponseSchema,
			{
				method: "POST",
				body: JSON.stringify(createServerPayload(candidate, slug))
			}
		);

		createdServerId = response.server.id;
		const server = await waitForServer(response.server.id);
		return materializeServer(server);
	} catch (error) {
		if (createdServerId) {
			throw new HetznerServerCreatedButNotReadyError(createdServerId, error);
		}
		throw error;
	}
}

// The mean of one Hetzner metrics series, and the reason it is careful: this
// number reaches `recordSample`, which compares it against a threshold that can
// suspend a paying customer's box. A missing series is 0 rather than NaN, and a
// non-numeric point is dropped rather than poisoning the average - either would
// otherwise propagate into a comparison whose answer is somebody's box going
// off the air.
export function seriesMean(
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
	const response = await hetznerRequest(
		`/servers/${serverId}/metrics?${params.toString()}`,
		hetznerMetricsResponseSchema
	);
	const timeSeries = response.metrics.time_series;

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
		// Pinned by the caller when the new machine has to land beside something
		// that is already placed - a plan change creates the replacement in the
		// location its parking volume lives in, because a Hetzner Volume can only
		// attach to a server in its own location.
		location: v.optional(vServerLocation),
		serverType: vServerType,
		slug: v.string()
	},
	handler: async (ctx, args) => {
		const locations = args.location
			? [args.location]
			: parseLocations(optionalEnv("HETZNER_BOX_LOCATIONS"));
		const candidates = placementCandidates(args.serverType, locations);
		let lastError: string | undefined;

		const existing = await existingCreatedServer(args.slug);
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
					await ctx.runMutation(internal.settings.closeCheckout, {
						by: "system:hetzner_resource_limit_exceeded"
					});
					throw error;
				}

				const recovered = await existingCreatedServer(args.slug);
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

		const response = await hetznerRequest(
			`/servers/${args.serverId}/actions/rebuild`,
			hetznerRebuildResponseSchema,
			{
				method: "POST",
				// Always send the current key. Hetzner supports user_data on rebuilds,
				// including snapshot restores; relying only on the key selected when the
				// server was created would make credential rotation ineffective here.
				body: JSON.stringify(rebuildServerPayload(image))
			}
		);
		if (!response.action) {
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
			await hetznerRequest(`/servers/${args.serverId}`, undefined, {
				method: "DELETE"
			});
		} catch (error) {
			if (!isNotFound(error)) throw error;
		}
	}
});

export function primaryIpListPath(page: number) {
	const params = new URLSearchParams({
		per_page: "50",
		page: String(page)
	});
	return `/primary_ips?${params.toString()}`;
}

// A Primary IP with no assignee belongs to no server. Every one of ours is
// created implicitly by `createServerPayload` (`enable_ipv4`/`enable_ipv6` with
// no explicit id), which is exactly the form Hetzner marks `auto_delete` and
// removes along with the server - so in normal operation this is never true for
// more than the few seconds that removal takes.
//
// Hetzner reports an unassigned Primary IP as `assignee_id: null`, and older
// responses omit the field entirely; both mean the same thing here.
export function isUnassignedPrimaryIp(primaryIp: {
	assignee_id?: number | null;
}) {
	return primaryIp.assignee_id === null || primaryIp.assignee_id === undefined;
}

// Reconciliation feed: every Primary IP in the project that is attached to
// nothing, so the cron can report a leak rather than let one bill quietly.
//
// Primary IPs carry none of our labels (Hetzner creates them, not us), so this
// cannot filter by `product=composery-web` the way the server and volume feeds
// do. That is also why reconciliation only ever reports these - an unlabelled
// resource is not provably ours to delete.
export const listUnassignedPrimaryIps = internalAction({
	args: {},
	returns: v.array(
		v.object({
			primaryIpId: v.number(),
			ip: v.optional(v.string()),
			createdAtMs: v.number()
		})
	),
	handler: async () => {
		const unassigned: {
			primaryIpId: number;
			ip?: string;
			createdAtMs: number;
		}[] = [];
		let page: number | null = 1;
		while (page) {
			const body: z.output<typeof hetznerPagedPrimaryIpsResponseSchema> =
				await hetznerRequest(
					primaryIpListPath(page),
					hetznerPagedPrimaryIpsResponseSchema
				);
			for (const primaryIp of body.primary_ips) {
				if (!isUnassignedPrimaryIp(primaryIp)) continue;
				unassigned.push({
					primaryIpId: primaryIp.id,
					ip: primaryIp.ip,
					createdAtMs: parseCreatedMs(primaryIp.created)
				});
			}
			page = body.meta.pagination.next_page;
		}
		return unassigned;
	}
});

async function waitForServerGone(serverId: number) {
	for (let attempt = 0; attempt < HETZNER_SERVER_POLL_ATTEMPTS; attempt += 1) {
		try {
			await hetznerRequest(`/servers/${serverId}`, hetznerServerResponseSchema);
		} catch (error) {
			if (isNotFound(error)) return;
			throw error;
		}
		await new Promise((resolve) =>
			setTimeout(resolve, HETZNER_POLL_INTERVAL_MS)
		);
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
	const response = await hetznerRequest(
		`/servers/${serverId}`,
		hetznerServerResponseSchema
	);
	return responseServer(response, serverId).status;
}

async function waitForServerOff(serverId: number) {
	for (let attempt = 0; attempt < HETZNER_SERVER_POLL_ATTEMPTS; attempt += 1) {
		if ((await serverStatus(serverId)) === "off") return true;
		await new Promise((resolve) =>
			setTimeout(resolve, HETZNER_POLL_INTERVAL_MS)
		);
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
		await hetznerRequest(
			`/servers/${args.serverId}/actions/poweroff`,
			undefined,
			{
				method: "POST"
			}
		);
	}
});

export const stopServer = internalAction({
	args: {
		serverId: v.optional(v.number())
	},
	handler: async (_ctx, args) => {
		if (!args.serverId) return;
		if ((await serverStatus(args.serverId)) === "off") return;

		await hetznerRequest(
			`/servers/${args.serverId}/actions/shutdown`,
			undefined,
			{ method: "POST" }
		);
		if (await waitForServerOff(args.serverId)) return;

		await hetznerRequest(
			`/servers/${args.serverId}/actions/poweroff`,
			undefined,
			{ method: "POST" }
		);
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
		await hetznerRequest(
			`/servers/${args.serverId}/actions/poweron`,
			undefined,
			{ method: "POST" }
		);
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

export function parseCreateImageResponse(
	body: z.output<typeof hetznerCreateImageResponseSchema>
): {
	actionId: number;
	imageId: number;
} {
	if (!body.action || !body.image) {
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
// optional. The image's own `disk_size` is deliberately not read: every box has
// the same disk for its whole life, so a snapshot always fits the machine it is
// restored onto and there is nothing to compare.
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
		let response: z.output<typeof hetznerCreateImageResponseSchema>;
		try {
			response = await hetznerRequest(
				`/servers/${args.serverId}/actions/create_image`,
				hetznerCreateImageResponseSchema,
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
				await ctx.runMutation(internal.settings.closeCheckout, {
					by: "system:hetzner_snapshot_resource_limit_exceeded"
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
		const response = await hetznerRequest(
			`/actions/${args.actionId}`,
			hetznerActionResponseSchema
		);
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
		const response = await hetznerRequest(
			`/images/${args.imageId}`,
			hetznerImageResponseSchema
		);
		if (!response.image) {
			throw new Error(`Hetzner image ${args.imageId} not found.`);
		}
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
		const response = await hetznerRequest(
			snapshotImageListPath(args.slug),
			hetznerImagesResponseSchema
		);
		return response.images.map((image) => ({
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
			const body: z.output<typeof hetznerPagedImageSummariesResponseSchema> =
				await hetznerRequest(
					productImageListPath(page),
					hetznerPagedImageSummariesResponseSchema
				);
			for (const image of body.images) {
				images.push({
					imageId: image.id,
					createdAtMs: parseCreatedMs(image.created)
				});
			}
			page = body.meta.pagination.next_page;
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
			const body: z.output<typeof hetznerPagedServerSummariesResponseSchema> =
				await hetznerRequest(
					productServerListPath(page),
					hetznerPagedServerSummariesResponseSchema
				);
			for (const server of body.servers) {
				servers.push({
					serverId: server.id,
					name: server.name,
					createdAtMs: parseCreatedMs(server.created)
				});
			}
			page = body.meta.pagination.next_page;
		}
		return servers;
	}
});

export const deleteImage = internalAction({
	args: { imageId: v.optional(v.number()) },
	handler: async (_ctx, args) => {
		if (!args.imageId) return;
		try {
			await hetznerRequest(`/images/${args.imageId}`, undefined, {
				method: "DELETE"
			});
		} catch (error) {
			if (!isNotFound(error)) throw error;
		}
	}
});

export type CreatedServer = {
	ipv4: string;
	ipv6: string;
	location: ServerLocation;
	serverId: number;
	serverType: ServerType;
};

// -- Parking volumes (Repair) -----------------------------------------------
//
// A Repair ("clean host, current files") parks the box's files on a Hetzner
// Volume for the few minutes it takes to wipe and reboot the server from the
// base image. The Volume is transient by design: Hetzner gives Volumes no
// backups or snapshots and excludes attached volumes from server snapshots, so
// they are never a permanent home for box data - only a short-lived staging
// area, created at the start of a repair and deleted the moment the files are
// safely back on the fresh host.

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
		// would risk a resumed repair reformatting a volume that already holds the
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

async function waitForVolumeActions(actions: ({ id: number } | undefined)[]) {
	for (const action of actions) {
		if (action?.id) await waitForActionSuccess(action.id);
	}
}

async function getVolume(volumeId: number) {
	const response = await hetznerRequest(
		`/volumes/${volumeId}`,
		hetznerVolumeResponseSchema
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
		const response = await hetznerRequest(
			"/volumes",
			hetznerCreateVolumeResponseSchema,
			{
				method: "POST",
				body: JSON.stringify(
					createVolumePayload(args.slug, args.location, sizeGb)
				)
			}
		);
		// Wait for create and the format that rides on it, so the box can mount the
		// volume straight away.
		await waitForVolumeActions([response.action, ...response.next_actions]);
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
		// Idempotent: a resumed repair may find it already on this server.
		if (volume.server === args.serverId) return;

		const response = await hetznerRequest(
			`/volumes/${args.volumeId}/actions/attach`,
			hetznerActionResponseSchema,
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
		let volume: z.output<typeof hetznerVolumeResponseSchema>["volume"];
		try {
			volume = await getVolume(args.volumeId);
		} catch (error) {
			if (isNotFound(error)) return;
			throw error;
		}
		// Idempotent: nothing to do if it is already detached.
		if (!volume.server) return;

		const response = await hetznerRequest(
			`/volumes/${args.volumeId}/actions/detach`,
			hetznerActionResponseSchema,
			{ method: "POST" }
		);
		await waitForVolumeActions([response.action]);
	}
});

export const deleteParkingVolume = internalAction({
	args: { volumeId: v.number() },
	handler: async (_ctx, args) => {
		let volume: z.output<typeof hetznerVolumeResponseSchema>["volume"];
		try {
			volume = await getVolume(args.volumeId);
		} catch (error) {
			if (isNotFound(error)) return;
			throw error;
		}
		// Hetzner refuses to delete an attached volume, so detach first (the server
		// may already be gone, in which case it is detached anyway).
		if (volume.server) {
			const response = await hetznerRequest(
				`/volumes/${args.volumeId}/actions/detach`,
				hetznerActionResponseSchema,
				{ method: "POST" }
			);
			await waitForVolumeActions([response.action]);
		}
		try {
			await hetznerRequest(`/volumes/${args.volumeId}`, undefined, {
				method: "DELETE"
			});
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
			const body: z.output<typeof hetznerPagedVolumeSummariesResponseSchema> =
				await hetznerRequest(
					productVolumeListPath(page),
					hetznerPagedVolumeSummariesResponseSchema
				);
			for (const volume of body.volumes) {
				volumes.push({
					volumeId: volume.id,
					createdAtMs: parseCreatedMs(volume.created)
				});
			}
			page = body.meta.pagination.next_page;
		}
		return volumes;
	}
});
