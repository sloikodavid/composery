import type { Infer } from "convex/values";
import { env } from "../../_generated/server";
import { getFakeAddress } from "../../fake_address";
import {
	httpStatus,
	isHttpClientError,
	isHttpServerError,
} from "../../http_status";
import type { FailureClass } from "../retries";
import type { powerOperationKind } from "../schema";
import {
	type HetznerCloudFirewallRule,
	hetznerCloudFirewallRules,
} from "./firewall";
import type { HetznerCloudServer } from "./observation";
import { hetznerCloudApiPrefix, hetznerCloudOrigin } from "./origin";
import { type HetznerCloudUsage, isValidHetznerCloudBudget } from "./pacing";
import type {
	hetznerCloudCollection,
	hetznerCloudResourceKind,
} from "./schema";

const requestTimeoutMs = 20_000;
const maxRetryAfterMs = 86_400_000;
const millisecondsPerSecond = 1000;
const maxLocations = 20;
const lookupPageSize = "2";
// Hetzner caps page size at 50; pagination is driven by next_page.
const listPageSize = "50";
const hetznerErrorCodePattern = /^[a-z_]{1,80}$/;
const locationPattern = /^[a-z0-9]+$/;
const controllerIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,61}[a-zA-Z0-9]$/;
const headerIntegerPattern = /^\d+$/;

type ResourceKind = Infer<typeof hetznerCloudResourceKind>;
type Collection = Infer<typeof hetznerCloudCollection>;
type PowerKind = Infer<typeof powerOperationKind>;
type Reply = Record<string, unknown>;

const inconclusiveStatuses: ReadonlySet<number> = new Set([
	// The request may have reached Hetzner, so do not resend it automatically.
	httpStatus.requestTimeout,
	httpStatus.conflict,
]);

const waitingStatuses: ReadonlySet<number> = new Set([
	// The request is valid but needs capacity, quota, or an external change.
	httpStatus.forbidden,
	httpStatus.preconditionFailed,
	httpStatus.locked,
]);

// biome-ignore-start lint/style/useNamingConvention: error code names
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
// biome-ignore-end lint/style/useNamingConvention: error code names

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
// Only settled provider statuses map to a usable server state; all transitions are changing.

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
	readonly status: number;
	readonly retryAfterMs: number;
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

	get isRejected() {
		return (
			isHttpClientError(this.status) && !inconclusiveStatuses.has(this.status)
		);
	}

	get failureClass(): FailureClass {
		// HTTP status alone cannot distinguish a quota, capacity, or lost request.
		const byCode = failureClasses[this.code];
		if (byCode !== undefined) {
			return byCode;
		}
		if (this.status === 0 || inconclusiveStatuses.has(this.status)) {
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
	locations: string[];
	image: string;
	serverType: string;
};

export type HetznerCloudOwner = {
	controllerId: string;
	allocationId: string;
};

export type HetznerCloudResource = {
	id: number;
	address?: string;
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

type HetznerCloudEnvironment = Readonly<{
	token: string | undefined;
	controllerId: string | undefined;
	locations: string | undefined;
	image: string | undefined;
	serverType: string | undefined;
}>;

/** Returns null when all provider settings are absent; partial settings throw. */
export function toHetznerCloudConfig(
	values: HetznerCloudEnvironment,
): HetznerCloudConfig | null {
	// No defaults: a deployment must choose every provider resource explicitly.
	const missing = [
		["HCLOUD_TOKEN", values.token],
		["HCLOUD_CONTROLLER_ID", values.controllerId],
		["HCLOUD_LOCATIONS", values.locations],
		["HCLOUD_IMAGE", values.image],
		["HCLOUD_SERVER_TYPE", values.serverType],
	].filter(([, value]) => !value);
	if (missing.length === Object.keys(values).length) {
		return null;
	}
	if (missing.length > 0) {
		throw new Error(
			`The Hetzner Cloud configuration is missing: ${missing
				.map(([name]) => name)
				.join(", ")}.`,
		);
	}
	const { controllerId, locations: locationValue, image, serverType } = values;
	if (
		controllerId === undefined ||
		locationValue === undefined ||
		image === undefined ||
		serverType === undefined
	) {
		throw new Error("The Hetzner Cloud configuration is incomplete.");
	}
	const locations = locationValue.split(",").map((location) => location.trim());
	if (
		locations.length === 0 ||
		locations.length > maxLocations ||
		locations.some((location) => !locationPattern.test(location)) ||
		new Set(locations).size !== locations.length
	) {
		throw new Error("The Hetzner Cloud location configuration is invalid.");
	}
	if (!controllerIdPattern.test(controllerId)) {
		throw new Error("The Hetzner Cloud controller ID is invalid.");
	}
	return {
		controllerId,
		locations,
		image,
		serverType,
	};
}

export function getHetznerCloudConfig(): HetznerCloudConfig | null {
	return toHetznerCloudConfig({
		token: env.HCLOUD_TOKEN,
		controllerId: env.HCLOUD_CONTROLLER_ID,
		locations: env.HCLOUD_LOCATIONS,
		image: env.HCLOUD_IMAGE,
		serverType: env.HCLOUD_SERVER_TYPE,
	});
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
	const resetHeader = response.headers.get("RateLimit-Reset");
	const reset = resetHeader === null ? undefined : Number(resetHeader);
	const seconds = retryAfter === null ? 0 : Number(retryAfter);
	const retryAfterMs = Number.isFinite(seconds)
		? seconds * millisecondsPerSecond
		: (Date.parse(retryAfter ?? "") || 0) - Date.now();
	const resetMs =
		reset !== undefined && Number.isFinite(reset)
			? reset * millisecondsPerSecond - Date.now()
			: 0;
	return Math.min(Math.max(0, retryAfterMs, resetMs), maxRetryAfterMs);
}

export function toHetznerCloudBudget(
	headers: Headers,
	observedAt = Date.now(),
): HetznerCloudUsage["budget"] {
	const limit = toHeaderInteger(headers, "RateLimit-Limit");
	const remaining = toHeaderInteger(headers, "RateLimit-Remaining");
	const reset = toHeaderInteger(headers, "RateLimit-Reset");
	if (limit === undefined || remaining === undefined || reset === undefined) {
		return undefined;
	}
	const budget = {
		limit,
		remaining,
		resetAt: reset * millisecondsPerSecond,
		observedAt,
	};
	return isValidHetznerCloudBudget(budget) ? budget : undefined;
}

function toHeaderInteger(headers: Headers, name: string) {
	const value = headers.get(name);
	return value !== null && headerIntegerPattern.test(value)
		? Number(value)
		: undefined;
}

function readBudget(usage: HetznerCloudUsage, response: Response) {
	const budget = toHetznerCloudBudget(response.headers);
	if (budget !== undefined) {
		usage.budget = budget;
	}
}

/** Per-operation usage; concurrent runs must not share a budget counter. */
export function createHetznerCloudUsage(): HetznerCloudUsage {
	return { requests: 0 };
}

async function callHetznerCloud(
	usage: HetznerCloudUsage,
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
	// Count before sending because a lost response may still represent provider-side work.
	usage.requests += 1;
	try {
		const apiUrl =
			getFakeAddress(env.HCLOUD_FAKE_URL, "HCLOUD_FAKE_URL") ??
			hetznerCloudOrigin;
		response = await fetch(`${apiUrl}${hetznerCloudApiPrefix}/${path}`, {
			method,
			headers: {
				// biome-ignore lint/style/useNamingConvention: external header name
				Authorization: `Bearer ${env.HCLOUD_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: body === undefined ? null : JSON.stringify(body),
			signal: AbortSignal.timeout(requestTimeoutMs),
		});
	} catch {
		throw new HetznerCloudError("transport_uncertain");
	}
	readBudget(usage, response);
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

export function requireOfferedServerType(reply: Reply | null, name: string) {
	// A type absent from the provider list is unavailable, not an unreadable response.
	const offered = requireList(reply?.server_types)
		.map(requireObject)
		.find((type) => type.name === name);
	if (offered === undefined) {
		throw new HetznerCloudError("server_type_unavailable", {
			status: httpStatus.badRequest,
		});
	}
	return offered;
}

export function requireOwnedResource(
	resource: Reply,
	controllerId: string,
	owned?: { allocationId: string; kind: ResourceKind },
) {
	// Labels are the ownership proof used after a lost create response.
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
	reply: Reply | null,
	collection: Collection,
	owner: HetznerCloudOwner,
	kind: ResourceKind,
) {
	const matches = requireList(reply?.[collection]);
	requireSinglePageLookup(reply, collection, matches.length);
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

export function requireSinglePageLookup(
	reply: Reply | null,
	collection: Collection,
	matchCount = requireList(reply?.[collection]).length,
) {
	const pagination = requireObject(requireObject(reply?.meta).pagination);
	const nextPage = pagination.next_page;
	if (nextPage === null) {
		return;
	}
	if (
		typeof nextPage !== "number" ||
		!Number.isSafeInteger(nextPage) ||
		nextPage <= 0
	) {
		throw new HetznerCloudError("invalid_response");
	}
	if (matchCount === 0) {
		throw new HetznerCloudError("invalid_response");
	}
	throw new HetznerCloudError("duplicate_resources", {
		status: httpStatus.conflict,
	});
}

async function findReply(
	usage: HetznerCloudUsage,

	owner: HetznerCloudOwner,
	kind: ResourceKind,
	knownId: number | undefined,
) {
	const collection = collections[kind];
	if (knownId !== undefined) {
		const reply = await callHetznerCloud(usage, `${collection}/${knownId}`);
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
	// biome-ignore-start lint/style/useNamingConvention: external snake_case parameters
	const labelQuery = new URLSearchParams({
		label_selector: `controller-id=${owner.controllerId},allocation-id=${owner.allocationId},resource-kind=${kind}`,
		per_page: lookupPageSize,
	});
	// biome-ignore-end lint/style/useNamingConvention: external snake_case parameters
	const labeled = await callHetznerCloud(usage, `${collection}?${labelQuery}`);
	const labeledMatch = requireOneMatch(labeled, collection, owner, kind);
	if (labeledMatch !== null) {
		return labeledMatch;
	}
	const named = await callHetznerCloud(
		usage,
		`${collection}?name=${getResourceName(owner.allocationId, kind)}&per_page=${lookupPageSize}`,
	);
	return requireOneMatch(named, collection, owner, kind);
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

function toServerAddress(value: unknown) {
	if (value === null || value === undefined) {
		return null;
	}
	const address = requireObject(value);
	return address.id === undefined
		? null
		: { id: requireId(address.id), address: requireText(address.ip) };
}

/** Maps a provider reply; missing addresses and firewalls are valid observations. */
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
		firewalls: requireList(publicNet.firewalls ?? [])
			.map(requireObject)
			.filter((firewall) => firewall.id !== undefined)
			.map((firewall) => ({
				id: requireId(firewall.id),
				isApplied: firewall.status === "applied",
			})),
	};
}

export async function findHetznerCloudResource(
	usage: HetznerCloudUsage,

	owner: HetznerCloudOwner,
	kind: ResourceKind,
	knownId: number | undefined,
): Promise<HetznerCloudResource | null> {
	const reply = await findReply(usage, owner, kind, knownId);
	return reply === null ? null : toResource(kind, reply);
}

export async function findHetznerCloudServer(
	usage: HetznerCloudUsage,

	owner: HetznerCloudOwner,
	knownId: number | undefined,
): Promise<HetznerCloudServer | null> {
	const reply = await findReply(usage, owner, "server", knownId);
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
			// biome-ignore-start lint/style/useNamingConvention: external snake_case fields
			return {
				...body,
				type: request.kind,
				assignee_type: "server",
				auto_delete: true,
			};
		// biome-ignore-end lint/style/useNamingConvention: external snake_case fields
		case "server":
			// biome-ignore-start lint/style/useNamingConvention: external snake_case fields
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
		// biome-ignore-end lint/style/useNamingConvention: external snake_case fields
	}
}

export async function createHetznerCloudResource(
	usage: HetznerCloudUsage,

	owner: HetznerCloudOwner,
	request: HetznerCloudCreateRequest,
): Promise<HetznerCloudResource & { actionId: number | null }> {
	// The caller records uncertainty before this request and must look up a lost response.
	const reply = await callHetznerCloud(
		usage,
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

/** Provider may still be deleting after acknowledging this request. */
export async function sendHetznerCloudDelete(
	usage: HetznerCloudUsage,

	kind: ResourceKind,
	id: number,
): Promise<
	{ status: "deleting"; actionId: number | null } | { status: "absent" }
> {
	try {
		const reply = await callHetznerCloud(
			usage,
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

export async function sendHetznerCloudPower(
	usage: HetznerCloudUsage,
	serverId: number,
	kind: PowerKind,
) {
	const reply = await callHetznerCloud(
		usage,
		`servers/${serverId}/actions/${powerActions[kind]}`,
		"POST",
	);
	return getActionId(reply);
}

export async function getHetznerCloudActionStatus(
	usage: HetznerCloudUsage,

	actionId: number,
): Promise<"running" | "succeeded" | "failed" | null> {
	const reply = await callHetznerCloud(usage, `actions/${actionId}`);
	if (reply === null) {
		return null;
	}
	return toActionStatus(requireObject(reply.action).status);
}

export function toActionStatus(value: unknown) {
	switch (value) {
		case "running":
			return "running" as const;
		case "success":
			return "succeeded" as const;
		case "error":
			return "failed" as const;
		default:
			throw new HetznerCloudError("invalid_response");
	}
}

function toScannedServer(resource: Reply) {
	try {
		return toServer(resource);
	} catch {
		return undefined;
	}
}

export async function listHetznerCloudResources(
	usage: HetznerCloudUsage,

	controllerId: string,
	collection: Collection,
	page: number,
) {
	// Inventory is the reconciliation path for resources created before a response was lost.
	// biome-ignore-start lint/style/useNamingConvention: external snake_case parameters
	const query = new URLSearchParams({
		label_selector: `controller-id=${controllerId}`,
		per_page: listPageSize,
		page: String(page),
	});
	// biome-ignore-end lint/style/useNamingConvention: external snake_case parameters
	const reply = await callHetznerCloud(usage, `${collection}?${query}`);
	const resources = requireList(reply?.[collection]).map((value) => {
		const resource = requireObject(value);
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
	usage: HetznerCloudUsage,

	firewallId: number,
	controllerId: string,
) {
	const reply = await callHetznerCloud(usage, `firewalls/${firewallId}`);
	if (reply === null) {
		throw new HetznerCloudError("project_firewall_missing", {
			status: httpStatus.forbidden,
		});
	}
	requireOwnedResource(requireObject(reply.firewall), controllerId);
}

export function isUsable(deprecation: unknown) {
	// A future deprecation date does not make a resource unusable today.
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
	usage: HetznerCloudUsage,

	locations: string[],
	image: string,
	serverType: string,
) {
	const type = requireOfferedServerType(
		await callHetznerCloud(usage, `server_types?name=${serverType}`),
		serverType,
	);
	const architecture = requireText(type.architecture);
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
		usage,
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

function toFirewallRules(value: unknown): HetznerCloudFirewallRule[] {
	return requireList(value).map((item) => {
		const rule = requireObject(item);
		return {
			direction: requireText(rule.direction),
			protocol: requireText(rule.protocol),
			...(typeof rule.port === "string" ? { port: rule.port } : {}),
			sourceIps: requireList(rule.source_ips).map((source) =>
				requireText(source),
			),
		};
	});
}

/** Finds, but never creates, the firewall that proves project ownership. */
export async function findHetznerCloudFirewall(
	usage: HetznerCloudUsage,
	controllerId: string,
) {
	const query = new URLSearchParams({
		// biome-ignore lint/style/useNamingConvention: external snake_case parameters
		label_selector: `controller-id=${controllerId}`,
	});
	const found = requireList(
		(await callHetznerCloud(usage, `firewalls?${query}`))?.firewalls,
	);
	if (found.length === 0) {
		return null;
	}
	if (found.length > 1) {
		throw new HetznerCloudError("duplicate_resources");
	}
	const firewall = requireObject(found[0]);
	return {
		id: requireId(firewall.id),
		rules: toFirewallRules(firewall.rules ?? []),
	};
}

export async function createHetznerCloudFirewall(
	usage: HetznerCloudUsage,
	controllerId: string,
) {
	const reply = await callHetznerCloud(usage, "firewalls", "POST", {
		name: `composery-${controllerId}`,
		labels: { "controller-id": controllerId },
		rules: hetznerCloudFirewallRules,
	});
	return requireId(requireObject(reply?.firewall).id);
}

export async function setHetznerCloudFirewallRules(
	usage: HetznerCloudUsage,
	firewallId: number,
) {
	await callHetznerCloud(
		usage,
		`firewalls/${firewallId}/actions/set_rules`,
		"POST",
		{
			rules: hetznerCloudFirewallRules,
		},
	);
}

export async function applyHetznerCloudFirewall(
	usage: HetznerCloudUsage,

	firewallId: number,
	serverId: number,
) {
	const reply = await callHetznerCloud(
		usage,
		`firewalls/${firewallId}/actions/apply_to_resources`,
		"POST",
		// biome-ignore lint/style/useNamingConvention: external field names
		{ apply_to: [{ type: "server", server: { id: serverId } }] },
	);
	const [action] = requireList(reply?.actions).map(requireObject);
	return action === undefined ? null : requireId(action.id);
}

export async function requireHetznerCloudFirewall(
	usage: HetznerCloudUsage,
	controllerId: string,
) {
	// The controller firewall proves that the token points at the expected project.
	const found = await findHetznerCloudFirewall(usage, controllerId);
	if (found === null) {
		throw new HetznerCloudError("project_firewall_missing", {
			status: httpStatus.forbidden,
		});
	}
	return found;
}
