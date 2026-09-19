import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import type { Infer } from "convex/values";
import { components } from "../../_generated/api";
import { env } from "../../_generated/server";
import { getFakeAddress } from "../../fake_address";
import {
	httpStatus,
	isHttpClientError,
	isHttpServerError,
} from "../../http_status";
import type { FailureClass } from "../retries";
import type { powerOperationKind } from "../schema";
import type { HetznerCloudServer } from "./observation";
import type {
	hetznerCloudCollection,
	hetznerCloudResourceKind,
} from "./schema";

const hetznerOrigin = "https://api.hetzner.cloud";
const apiPrefix = "/v1";
const requestTimeoutMs = 20_000;
const maxRetryAfterMs = 86_400_000;
const millisecondsPerSecond = 1000;
const serverType = "cx23";
const architecture = "x86";
const defaultImage = "ubuntu-24.04";
const maxLocations = 20;
const lookupPageSize = "2";
// The most Hetzner gives at once. Asking for more is answered with fifty rather than refused,
// and what a page holds is read from the reply, so this only decides how many requests a walk
// takes. `meta.pagination.next_page` is what says whether another one follows.
const listPageSize = "50";
const hetznerErrorCodePattern = /^[a-z_]{1,80}$/;
const locationPattern = /^[a-z0-9]+$/;
const controllerIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,61}[a-zA-Z0-9]$/;

type ResourceKind = Infer<typeof hetznerCloudResourceKind>;
type Collection = Infer<typeof hetznerCloudCollection>;
type PowerKind = Infer<typeof powerOperationKind>;
type Reply = Record<string, unknown>;

/** Client errors that do not prove a request had no effect. */
const inconclusiveStatuses: ReadonlySet<number> = new Set([
	httpStatus.requestTimeout,
	httpStatus.conflict,
]);

/** Statuses that mean the request is right and something outside it has to change first. */
const waitingStatuses: ReadonlySet<number> = new Set([
	httpStatus.forbidden,
	httpStatus.preconditionFailed,
	httpStatus.locked,
]);

/** What our own codes mean, where the status alone would say the wrong thing. */
// biome-ignore-start lint/style/useNamingConvention: error codes use snake_case
const failureClasses: Partial<Record<HetznerCloudErrorCode, FailureClass>> = {
	capacity_unavailable: "waiting",
	duplicate_resources: "waiting",
	image_unavailable: "waiting",
	invalid_response: "bug",
	project_firewall_missing: "waiting",
	resource_identity_mismatch: "waiting",
	server_type_unavailable: "waiting",
	token_missing: "waiting",
	transport_uncertain: "indeterminate",
};
// biome-ignore-end lint/style/useNamingConvention: error codes use snake_case

const collections = {
	server: "servers",
	ipv4: "primary_ips",
	ipv6: "primary_ips",
} as const satisfies Record<ResourceKind, Collection>;

const replyKeys = {
	server: "server",
	ipv4: "primary_ip",
	ipv6: "primary_ip",
} as const satisfies Record<ResourceKind, string>;

const powerActions = {
	start: "poweron",
	stop: "shutdown",
	forceStop: "poweroff",
} as const satisfies Record<PowerKind, string>;

// Hetzner's documented server statuses. Only a settled status says whether the server runs.
const serverStatuses = {
	initializing: "changing",
	starting: "changing",
	running: "running",
	stopping: "changing",
	off: "stopped",
	deleting: "changing",
	migrating: "changing",
	rebuilding: "changing",
	unknown: "changing",
} as const satisfies Record<string, HetznerCloudServer["status"]>;

/**
 * Paces this deployment's requests. Each queue has its own allowance, so neither can starve the
 * other, and both together stay under Hetzner's own hourly limit.
 *
 * Cleanup is not the smaller of the two. Taking an allocation apart costs more claims than putting
 * one together, and it is the path that releases a customer's addresses and quota, so a burst that
 * cannot finish one deletion would leave those held for minutes for no reason.
 */
export const hetznerCloudRateLimiter = new RateLimiter(components.rateLimiter, {
	hetznerCloudWork: {
		kind: "token bucket",
		rate: 2000,
		period: HOUR,
		capacity: 30,
	},
	hetznerCloudCleanup: {
		kind: "token bucket",
		rate: 1000,
		period: HOUR,
		capacity: 30,
	},
});

export type HetznerCloudErrorCode =
	| "capacity_unavailable"
	| "duplicate_resources"
	| "image_unavailable"
	| "invalid_response"
	| "project_firewall_missing"
	| "request_rejected"
	| "resource_identity_mismatch"
	| "server_type_unavailable"
	| "token_missing"
	| "transport_uncertain";

export class HetznerCloudError extends Error {
	readonly code: HetznerCloudErrorCode;
	/** 0 when no HTTP response exists. */
	readonly status: number;
	readonly retryAfterMs: number;
	/** Hetzner's own code, when it sent one. */
	readonly hetznerErrorCode: string | undefined;

	constructor(
		code: HetznerCloudErrorCode,
		details: {
			status?: number;
			retryAfterMs?: number;
			hetznerErrorCode?: string;
		} = {},
	) {
		super(code);
		this.name = "HetznerCloudError";
		this.code = code;
		this.status = details.status ?? 0;
		this.retryAfterMs = details.retryAfterMs ?? 0;
		this.hetznerErrorCode = details.hetznerErrorCode;
	}

	/** Hetzner answered and refused, so the request did not take effect. */
	get isRejected() {
		return (
			isHttpClientError(this.status) && !inconclusiveStatuses.has(this.status)
		);
	}

	/**
	 * What this failure means for what to do next, by what Hetzner's own description says each
	 * answer means. Its status alone does not decide: 403 is a quota to raise, 412 is capacity to
	 * wait for, and 409 is Hetzner asking for the request again.
	 */
	get failureClass(): FailureClass {
		const byCode = failureClasses[this.code];
		if (byCode !== undefined) {
			return byCode;
		}
		if (this.status === 0 || inconclusiveStatuses.has(this.status)) {
			// Nothing answered, or the answer does not prove the request had no effect.
			return "indeterminate";
		}
		if (
			isHttpServerError(this.status) ||
			this.status === httpStatus.tooManyRequests
		) {
			return "transient";
		}
		return waitingStatuses.has(this.status) ? "waiting" : "invalid";
	}
}

export type HetznerCloudConfig = {
	controllerId: string;
	firewallId: number;
	locations: string[];
	image: string;
};

/** The labels that make a resource this controller's, for one allocation. */
export type HetznerCloudOwner = {
	controllerId: string;
	allocationId: string;
};

export type HetznerCloudResource = {
	id: number;
	/** A Primary IP's address. A server's addresses come from its own record. */
	address?: string;
	/** A Primary IP that is attached to a server. Always false for a server. */
	isAssigned: boolean;
};

export type HetznerCloudCreateRequest =
	| { kind: "ipv4" | "ipv6"; location: string }
	| {
			kind: "server";
			location: string;
			serverType: string;
			imageId: number;
			ipv4Id: number;
			ipv6Id: number;
			firewallId: number;
			userData: string;
	  };

/** Returns null when Hetzner Cloud is not configured. Throws when the configuration is invalid. */
export function getHetznerCloudConfig(): HetznerCloudConfig | null {
	if (
		!env.HCLOUD_TOKEN ||
		!env.HCLOUD_CONTROLLER_ID ||
		!env.HCLOUD_LOCATIONS ||
		!env.HCLOUD_FIREWALL_ID
	) {
		return null;
	}
	const locations = env.HCLOUD_LOCATIONS.split(",").map((location) =>
		location.trim(),
	);
	if (
		locations.length === 0 ||
		locations.length > maxLocations ||
		locations.some((location) => !locationPattern.test(location)) ||
		new Set(locations).size !== locations.length
	) {
		throw new Error("The Hetzner Cloud location configuration is invalid.");
	}
	if (!controllerIdPattern.test(env.HCLOUD_CONTROLLER_ID)) {
		throw new Error("The Hetzner Cloud controller ID is invalid.");
	}
	const firewallId = Number(env.HCLOUD_FIREWALL_ID);
	if (!Number.isSafeInteger(firewallId) || firewallId <= 0) {
		throw new Error("The Hetzner Cloud firewall ID is invalid.");
	}
	return {
		controllerId: env.HCLOUD_CONTROLLER_ID,
		firewallId,
		locations,
		image: env.HCLOUD_IMAGE ?? defaultImage,
	};
}

function requireObject(value: unknown): Reply {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new HetznerCloudError("invalid_response");
	}
	return value as Reply;
}

function requireList(value: unknown): unknown[] {
	if (!Array.isArray(value)) {
		throw new HetznerCloudError("invalid_response");
	}
	return value;
}

function requireText(value: unknown): string {
	if (typeof value !== "string") {
		throw new HetznerCloudError("invalid_response");
	}
	return value;
}

function requireId(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new HetznerCloudError("invalid_response");
	}
	return value;
}

function toRetryAfterMs(response: Response) {
	if (response.status !== httpStatus.tooManyRequests) {
		return 0;
	}
	const retryAfter = response.headers.get("Retry-After");
	const reset = Number(response.headers.get("RateLimit-Reset"));
	const seconds = retryAfter === null ? 0 : Number(retryAfter);
	const retryAfterMs = Number.isFinite(seconds)
		? seconds * millisecondsPerSecond
		: (Date.parse(retryAfter ?? "") || 0) - Date.now();
	const resetMs = Number.isFinite(reset)
		? reset * millisecondsPerSecond - Date.now()
		: 0;
	return Math.min(Math.max(0, retryAfterMs, resetMs), maxRetryAfterMs);
}

/** No implicit retries. A request that failed can still have reached Hetzner. */
async function callHetznerCloud(
	path: string,
	method = "GET",
	body?: unknown,
): Promise<Reply | null> {
	if (!env.HCLOUD_TOKEN) {
		throw new HetznerCloudError("token_missing", {
			status: httpStatus.unauthorized,
		});
	}
	let response: Response;
	try {
		const apiUrl =
			getFakeAddress(env.HCLOUD_FAKE_URL, "HCLOUD_FAKE_URL") ?? hetznerOrigin;
		response = await fetch(`${apiUrl}${apiPrefix}/${path}`, {
			method,
			headers: {
				// biome-ignore lint/style/useNamingConvention: HTTP defines the Authorization header name
				Authorization: `Bearer ${env.HCLOUD_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: body === undefined ? null : JSON.stringify(body),
			signal: AbortSignal.timeout(requestTimeoutMs),
		});
	} catch {
		throw new HetznerCloudError("transport_uncertain");
	}
	if (response.status === httpStatus.notFound && method === "GET") {
		return null;
	}
	if (response.status === httpStatus.noContent) {
		return {};
	}
	let data: Reply;
	try {
		data = requireObject(await response.json());
	} catch {
		throw new HetznerCloudError("invalid_response", {
			status: response.status,
		});
	}
	if (!response.ok) {
		const hetznerErrorCode = requireObject(data.error).code;
		throw new HetznerCloudError("request_rejected", {
			status: response.status,
			retryAfterMs: toRetryAfterMs(response),
			...(typeof hetznerErrorCode === "string" &&
			hetznerErrorCodePattern.test(hetznerErrorCode)
				? { hetznerErrorCode }
				: {}),
		});
	}
	return data;
}

function getResourceName(allocationId: string, kind: ResourceKind) {
	return `c-${allocationId}-${kind}`;
}

function getActionId(reply: Reply | null) {
	return reply?.action ? requireId(requireObject(reply.action).id) : null;
}

/**
 * The server type Composery uses, read from Hetzner's answer to asking for it by name. A name that
 * matches nothing answers with an empty list, which is Hetzner saying the type is gone rather than
 * failing to answer. A retired type does not come back, so this is permanent like a missing image,
 * and unlike capacity, which is the other thing a precondition failure would mean. Exported so a
 * test can put Hetzner's own shapes through it: the request is one every allocation makes, so no
 * test can script it for one allocation alone.
 */
export function requireOfferedServerType(reply: Reply | null) {
	const offered = requireList(reply?.server_types)
		.map(requireObject)
		.find(
			(type) => type.name === serverType && type.architecture === architecture,
		);
	if (offered === undefined) {
		throw new HetznerCloudError("server_type_unavailable", {
			status: httpStatus.badRequest,
		});
	}
	return offered;
}

/**
 * Throws unless the resource carries this controller's labels, and the allocation's labels when
 * given. Exported so a test can put Hetzner's own shapes through it: the project firewall is read at
 * the start of every allocation's work, so no test can script that read for one allocation alone.
 */
export function requireOwnedResource(
	resource: Reply,
	controllerId: string,
	owned?: { allocationId: string; kind: ResourceKind },
) {
	// Hetzner requires labels on a server and on a Primary IP, but not on a firewall. One that
	// carries none is a resource that is not ours, which is a verdict, not a reply we cannot read.
	const labels =
		resource.labels === undefined ? {} : requireObject(resource.labels);
	if (
		labels["controller-id"] !== controllerId ||
		(owned !== undefined &&
			(labels["allocation-id"] !== owned.allocationId ||
				labels["resource-kind"] !== owned.kind))
	) {
		throw new HetznerCloudError("resource_identity_mismatch", {
			status: httpStatus.conflict,
		});
	}
	requireId(resource.id);
}

function requireOneMatch(
	matches: unknown[],
	owner: HetznerCloudOwner,
	kind: ResourceKind,
) {
	if (matches.length > 1) {
		throw new HetznerCloudError("duplicate_resources", {
			status: httpStatus.conflict,
		});
	}
	if (matches.length === 0) {
		return null;
	}
	const resource = requireObject(matches[0]);
	requireOwnedResource(resource, owner.controllerId, {
		allocationId: owner.allocationId,
		kind,
	});
	return resource;
}

async function findReply(
	owner: HetznerCloudOwner,
	kind: ResourceKind,
	knownId: number | undefined,
) {
	const collection = collections[kind];
	if (knownId !== undefined) {
		const reply = await callHetznerCloud(`${collection}/${knownId}`);
		if (reply === null) {
			return null;
		}
		const found = requireObject(reply[replyKeys[kind]]);
		requireOwnedResource(found, owner.controllerId, {
			allocationId: owner.allocationId,
			kind,
		});
		return found;
	}
	// Labels also find a resource that was renamed at Hetzner after a lost create response.
	// biome-ignore-start lint/style/useNamingConvention: the Hetzner Cloud API requires snake_case parameters
	const labelQuery = new URLSearchParams({
		label_selector: `controller-id=${owner.controllerId},allocation-id=${owner.allocationId},resource-kind=${kind}`,
		per_page: lookupPageSize,
	});
	// biome-ignore-end lint/style/useNamingConvention: the Hetzner Cloud API requires snake_case parameters
	const labeled = await callHetznerCloud(`${collection}?${labelQuery}`);
	const labeledMatch = requireOneMatch(
		requireList(labeled?.[collection]),
		owner,
		kind,
	);
	if (labeledMatch !== null) {
		return labeledMatch;
	}
	const named = await callHetznerCloud(
		`${collection}?name=${getResourceName(owner.allocationId, kind)}&per_page=${lookupPageSize}`,
	);
	return requireOneMatch(requireList(named?.[collection]), owner, kind);
}

function toResource(kind: ResourceKind, reply: Reply): HetznerCloudResource {
	const id = requireId(reply.id);
	switch (kind) {
		case "server":
			return { id, isAssigned: false };
		case "ipv4":
		case "ipv6":
			return {
				id,
				address: requireText(reply.ip),
				isAssigned: reply.assignee_id !== null,
			};
	}
}

function isHetznerServerStatus(
	value: string,
): value is keyof typeof serverStatuses {
	return Object.hasOwn(serverStatuses, value);
}

/** One of a server's public addresses, or null when Hetzner says it has none of that kind. */
function toServerAddress(value: unknown) {
	if (value === null || value === undefined) {
		return null;
	}
	const address = requireObject(value);
	// `id` is not required here, and an address without one cannot be matched to the Primary IP
	// this allocation recorded, which is the mismatch the worker already handles.
	return address.id === undefined
		? null
		: { id: requireId(address.id), address: requireText(address.ip) };
}

/** Reads one server as Hetzner describes it. Exported so a test can put its own shapes through. */
export function toServer(reply: Reply): HetznerCloudServer {
	const status = requireText(reply.status);
	if (!isHetznerServerStatus(status)) {
		throw new HetznerCloudError("invalid_response");
	}
	const publicNet = requireObject(reply.public_net);
	return {
		id: requireId(reply.id),
		status: serverStatuses[status],
		ipv4: toServerAddress(publicNet.ipv4),
		ipv6: toServerAddress(publicNet.ipv6),
		serverType: requireText(requireObject(reply.server_type).name),
		location: requireText(requireObject(reply.location).name),
		// Neither `firewalls` nor the fields of one are required. A server with none is a server
		// whose firewall was detached, which the worker reports; it is not an unreadable reply.
		firewalls: requireList(publicNet.firewalls ?? [])
			.map(requireObject)
			.filter((firewall) => firewall.id !== undefined)
			.map((firewall) => ({
				id: requireId(firewall.id),
				isApplied: firewall.status === "applied",
			})),
	};
}

/** Finds the allocation's resource by its known ID, or by its labels and then its name. */
export async function findHetznerCloudResource(
	owner: HetznerCloudOwner,
	kind: ResourceKind,
	knownId: number | undefined,
): Promise<HetznerCloudResource | null> {
	const reply = await findReply(owner, kind, knownId);
	return reply === null ? null : toResource(kind, reply);
}

export async function findHetznerCloudServer(
	owner: HetznerCloudOwner,
	knownId: number | undefined,
): Promise<HetznerCloudServer | null> {
	const reply = await findReply(owner, "server", knownId);
	return reply === null ? null : toServer(reply);
}

function toCreateBody(
	owner: HetznerCloudOwner,
	controllerId: string,
	request: HetznerCloudCreateRequest,
) {
	const body = {
		name: getResourceName(owner.allocationId, request.kind),
		location: request.location,
		labels: {
			"controller-id": controllerId,
			"allocation-id": owner.allocationId,
			"resource-kind": request.kind,
		},
	};
	switch (request.kind) {
		case "ipv4":
		case "ipv6":
			// biome-ignore-start lint/style/useNamingConvention: the Hetzner Cloud API requires snake_case fields
			return {
				...body,
				type: request.kind,
				assignee_type: "server",
				auto_delete: true,
			};
		// biome-ignore-end lint/style/useNamingConvention: the Hetzner Cloud API requires snake_case fields
		case "server":
			// biome-ignore-start lint/style/useNamingConvention: the Hetzner Cloud API requires snake_case fields
			return {
				...body,
				server_type: request.serverType,
				image: request.imageId,
				start_after_create: true,
				public_net: {
					enable_ipv4: true,
					enable_ipv6: true,
					ipv4: request.ipv4Id,
					ipv6: request.ipv6Id,
				},
				firewalls: [{ firewall: request.firewallId }],
				user_data: request.userData,
			};
		// biome-ignore-end lint/style/useNamingConvention: the Hetzner Cloud API requires snake_case fields
	}
}

/** Sends one create request. It throws when Hetzner's answer is lost, so the caller must look the resource up before creating it again. */
export async function createHetznerCloudResource(
	owner: HetznerCloudOwner,
	request: HetznerCloudCreateRequest,
): Promise<HetznerCloudResource & { actionId: number | null }> {
	const reply = await callHetznerCloud(
		collections[request.kind],
		"POST",
		toCreateBody(owner, owner.controllerId, request),
	);
	const created = requireObject(reply?.[replyKeys[request.kind]]);
	requireOwnedResource(created, owner.controllerId, {
		allocationId: owner.allocationId,
		kind: request.kind,
	});
	return { ...toResource(request.kind, created), actionId: getActionId(reply) };
}

/** Hetzner may still be deleting a resource it has accepted a delete request for. */
export async function sendHetznerCloudDelete(
	kind: ResourceKind,
	id: number,
): Promise<
	{ status: "deleting"; actionId: number | null } | { status: "absent" }
> {
	try {
		const reply = await callHetznerCloud(
			`${collections[kind]}/${id}`,
			"DELETE",
		);
		return { status: "deleting", actionId: getActionId(reply) };
	} catch (error) {
		if (
			error instanceof HetznerCloudError &&
			error.status === httpStatus.notFound
		) {
			return { status: "absent" };
		}
		throw error;
	}
}

/** Returns the action ID when Hetzner started an action for the request. */
export async function sendHetznerCloudPower(serverId: number, kind: PowerKind) {
	const reply = await callHetznerCloud(
		`servers/${serverId}/actions/${powerActions[kind]}`,
		"POST",
	);
	return getActionId(reply);
}

/** Returns null when Hetzner no longer knows the action. */
export async function getHetznerCloudActionStatus(
	actionId: number,
): Promise<"running" | "succeeded" | "failed" | null> {
	const reply = await callHetznerCloud(`actions/${actionId}`);
	if (reply === null) {
		return null;
	}
	const status = requireObject(reply.action).status;
	if (status === "running") {
		return "running";
	}
	return status === "error" ? "failed" : "succeeded";
}

/**
 * One server from a page, or nothing when Hetzner described it in a way we cannot read. One odd
 * server must not stop a scan that is also how every other server stays current.
 */
function toScannedServer(resource: Reply) {
	try {
		return toServer(resource);
	} catch {
		return undefined;
	}
}

/** One page of every resource that carries this controller's label, known or not. */
export async function listHetznerCloudResources(
	controllerId: string,
	collection: Collection,
	page: number,
) {
	// biome-ignore-start lint/style/useNamingConvention: the Hetzner Cloud API requires snake_case parameters
	const query = new URLSearchParams({
		label_selector: `controller-id=${controllerId}`,
		per_page: listPageSize,
		page: String(page),
	});
	// biome-ignore-end lint/style/useNamingConvention: the Hetzner Cloud API requires snake_case parameters
	const reply = await callHetznerCloud(`${collection}?${query}`);
	const resources = requireList(reply?.[collection]).map((value) => {
		const resource = requireObject(value);
		// Hetzner requires labels on a server and on a Primary IP, but not on a firewall. One that
		// carries none is a resource that is not ours, which is a verdict, not a reply we cannot read.
		const labels =
			resource.labels === undefined ? {} : requireObject(resource.labels);
		const allocationId = labels["allocation-id"];
		const kind = labels["resource-kind"];
		const server =
			collection === "servers" ? toScannedServer(resource) : undefined;
		return {
			id: requireId(resource.id),
			allocationId: typeof allocationId === "string" ? allocationId : "",
			kind: typeof kind === "string" ? kind : "",
			...(server === undefined ? {} : { server }),
		};
	});
	const next = requireObject(requireObject(reply?.meta).pagination).next_page;
	return { resources, nextPage: next === null ? null : requireId(next) };
}

/** The labeled firewall proves that the token belongs to this controller's project. */
export async function requireHetznerCloudController(
	firewallId: number,
	controllerId: string,
) {
	const reply = await callHetznerCloud(`firewalls/${firewallId}`);
	if (reply === null) {
		throw new HetznerCloudError("project_firewall_missing", {
			status: httpStatus.forbidden,
		});
	}
	requireOwnedResource(requireObject(reply.firewall), controllerId);
}

/**
 * Whether something Hetzner has announced the deprecation of can still be used. Deprecation
 * carries the day it was announced and the day it stops working, and Hetzner announces months
 * ahead. Reading the announcement as "gone" would refuse every new server from the day Hetzner
 * says a word, which is a date it chooses and we would not see coming. Exported so a test can put
 * Hetzner's own shapes through the decision.
 */
export function isUsable(deprecation: unknown) {
	if (deprecation === null || deprecation === undefined) {
		return true;
	}
	const until = Date.parse(
		requireText(requireObject(deprecation).unavailable_after),
	);
	return Number.isNaN(until) || until > Date.now();
}

function isSupportedLocation(
	supported: Reply[],
	name: string,
	requireCapacity: boolean,
) {
	return supported.some(
		(location) =>
			location.name === name &&
			isUsable(location.deprecation) &&
			(!requireCapacity || location.available === true),
	);
}

export async function resolveHetznerCloudSpec(
	locations: string[],
	image: string,
) {
	const type = requireOfferedServerType(
		await callHetznerCloud(`server_types?name=${serverType}`),
	);
	const supported = requireList(type.locations).map(requireObject);
	const location =
		locations.find((name) => isSupportedLocation(supported, name, true)) ??
		locations.find((name) => isSupportedLocation(supported, name, false));
	if (location === undefined) {
		throw new HetznerCloudError("capacity_unavailable", {
			status: httpStatus.preconditionFailed,
		});
	}
	const images = await callHetznerCloud(
		`images?name=${encodeURIComponent(image)}&architecture=${architecture}&type=system`,
	);
	const candidate = requireList(images?.images)
		.map(requireObject)
		.find(
			(item) =>
				item.name === image &&
				item.architecture === architecture &&
				item.status === "available" &&
				isUsable(item.deprecation),
		);
	if (candidate === undefined) {
		throw new HetznerCloudError("image_unavailable", {
			status: httpStatus.badRequest,
		});
	}
	return { location, imageId: requireId(candidate.id), serverType };
}
