import { HOUR, RateLimiter } from "@convex-dev/rate-limiter";
import { ConvexError } from "convex/values";
import { components } from "../../_generated/api";
import { env } from "../../_generated/server";
import { httpStatus } from "../../http_status";

const apiUrl = "https://api.hetzner.cloud/v1";
const requestTimeoutMs = 20_000;
const maxRetryAfterMs = 86_400_000;
const millisecondsPerSecond = 1000;
const serverType = "cx23";
const architecture = "x86";
const defaultImage = "ubuntu-24.04";
const maxLocations = 20;
const hetznerErrorCodePattern = /^[a-z_]{1,80}$/;
const locationPattern = /^[a-z0-9]+$/;
const controllerIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,61}[a-zA-Z0-9]$/;

// Paces this deployment's requests. Cleanup has its own allowance, so new work cannot block it.
export const hetznerCloudRateLimiter = new RateLimiter(components.rateLimiter, {
	hetznerCloudWork: {
		kind: "token bucket",
		rate: 2000,
		period: HOUR,
		capacity: 30,
	},
	hetznerCloudCleanup: {
		kind: "token bucket",
		rate: 500,
		period: HOUR,
		capacity: 16,
	},
});

export type HetznerCloudErrorCode =
	| "address_identity_mismatch"
	| "addresses_missing"
	| "capacity_unavailable"
	| "credentials_missing"
	| "duplicate_resources"
	| "firewall_detached"
	| "image_unavailable"
	| "invalid_response"
	| "project_firewall_missing"
	| "request_rejected"
	| "resource_identity_mismatch"
	| "server_configuration_mismatch"
	| "server_type_unavailable"
	| "spec_missing"
	| "transport_uncertain";

/** `status` is 0 when no HTTP response exists. `hetznerErrorCode` is Hetzner's own code, when it sent one. */
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
}

export type HetznerCloudConfig = {
	controllerId: string;
	firewallId: number;
	locations: string[];
	image: string;
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
		throw new ConvexError({
			message: "The Hetzner Cloud location configuration is invalid.",
		});
	}
	if (!controllerIdPattern.test(env.HCLOUD_CONTROLLER_ID)) {
		throw new ConvexError({
			message: "The Hetzner Cloud controller ID is invalid.",
		});
	}
	const firewallId = Number(env.HCLOUD_FIREWALL_ID);
	if (!Number.isSafeInteger(firewallId) || firewallId <= 0) {
		throw new ConvexError({
			message: "The Hetzner Cloud firewall ID is invalid.",
		});
	}
	return {
		controllerId: env.HCLOUD_CONTROLLER_ID,
		firewallId,
		locations,
		image: env.HCLOUD_IMAGE ?? defaultImage,
	};
}

export function requireObject(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new HetznerCloudError("invalid_response");
	}
	return value as Record<string, unknown>;
}

export function requireList(value: unknown): unknown[] {
	if (!Array.isArray(value)) {
		throw new HetznerCloudError("invalid_response");
	}
	return value;
}

export function requireText(value: unknown): string {
	if (typeof value !== "string") {
		throw new HetznerCloudError("invalid_response");
	}
	return value;
}

export function requireId(value: unknown): number {
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

// No implicit retries. A request that failed can still have reached Hetzner.
export async function callHetznerCloud(
	path: string,
	method = "GET",
	body?: unknown,
): Promise<Record<string, unknown> | null> {
	if (!env.HCLOUD_TOKEN) {
		throw new HetznerCloudError("credentials_missing", {
			status: httpStatus.unauthorized,
		});
	}
	let response: Response;
	try {
		response = await fetch(`${apiUrl}/${path}`, {
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
	let data: Record<string, unknown>;
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

/** Throws unless the resource carries this controller's labels, and the allocation's labels when given. */
export function requireOwnedResource(
	resource: Record<string, unknown>,
	controllerId: string,
	allocation?: { id: string; kind: string },
) {
	const labels = requireObject(resource.labels);
	if (
		labels["controller-id"] !== controllerId ||
		(allocation !== undefined &&
			(labels["allocation-id"] !== allocation.id ||
				labels["resource-kind"] !== allocation.kind))
	) {
		throw new HetznerCloudError("resource_identity_mismatch", {
			status: httpStatus.conflict,
		});
	}
	requireId(resource.id);
}

/** The labeled firewall proves that the token belongs to this controller's project. */
export async function requireController(
	firewallId: number,
	controllerId: string,
) {
	const response = await callHetznerCloud(`firewalls/${firewallId}`);
	if (response === null) {
		throw new HetznerCloudError("project_firewall_missing", {
			status: httpStatus.forbidden,
		});
	}
	requireOwnedResource(requireObject(response.firewall), controllerId);
}

function isSupportedLocation(
	supported: Record<string, unknown>[],
	name: string,
	requireCapacity: boolean,
) {
	return supported.some(
		(location) =>
			location.name === name &&
			location.deprecation === null &&
			(!requireCapacity || location.available === true),
	);
}

export async function resolveSpec(locations: string[], image: string) {
	const types = await callHetznerCloud(`server_types?name=${serverType}`);
	const type = requireObject(requireList(types?.server_types)[0]);
	if (type.name !== serverType || type.architecture !== architecture) {
		throw new HetznerCloudError("server_type_unavailable", {
			status: httpStatus.preconditionFailed,
		});
	}
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
				item.deprecation === null,
		);
	if (candidate === undefined) {
		throw new HetznerCloudError("image_unavailable", {
			status: httpStatus.badRequest,
		});
	}
	return { location, imageId: requireId(candidate.id), serverType };
}
