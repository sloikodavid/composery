import { env } from "./_generated/server";

export class ProviderError extends Error {
	readonly code: string;
	readonly status: number;
	readonly retryAfterMs: number;
	constructor(code: string, status = 0, retryAfterMs = 0) {
		super(code);
		this.code = code;
		this.status = status;
		this.retryAfterMs = retryAfterMs;
	}
}
export function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new ProviderError("invalid_response");
	return value as Record<string, unknown>;
}
export function list(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new ProviderError("invalid_response");
	return value;
}
export function textField(value: unknown): string {
	if (typeof value !== "string") throw new ProviderError("invalid_response");
	return value;
}
export function idField(value: unknown): number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
		throw new ProviderError("invalid_response");
	return value;
}

// No implicit retries. An unsuccessful mutation can still have reached the provider.
export async function request(
	path: string,
	method = "GET",
	body?: unknown,
): Promise<Record<string, unknown> | null> {
	if (!env.HCLOUD_TOKEN) throw new ProviderError("credentials_missing", 401);
	let response: Response;
	try {
		response = await fetch(`https://api.hetzner.cloud/v1/${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${env.HCLOUD_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: body === undefined ? null : JSON.stringify(body),
			signal: AbortSignal.timeout(20_000),
		});
	} catch {
		throw new ProviderError("transport_unknown");
	}
	if (response.status === 404 && method === "GET") return null;
	if (response.status === 204) return {};
	let data: Record<string, unknown>;
	try {
		data = object(await response.json());
	} catch {
		throw new ProviderError("invalid_response", response.status);
	}
	if (!response.ok) {
		const code = object(data.error).code;
		const retryAfter = response.headers.get("Retry-After");
		const reset = Number(response.headers.get("RateLimit-Reset"));
		const seconds = retryAfter === null ? 0 : Number(retryAfter);
		const retryAfterMs =
			response.status === 429
				? Math.max(
						0,
						Number.isFinite(seconds)
							? seconds * 1000
							: (Date.parse(retryAfter ?? "") || 0) - Date.now(),
						Number.isFinite(reset) ? reset * 1000 - Date.now() : 0,
					)
				: 0;
		throw new ProviderError(
			typeof code === "string" && /^[a-z_]{1,80}$/.test(code)
				? code
				: "request_failed",
			response.status,
			Math.min(retryAfterMs, 86_400_000),
		);
	}
	return data;
}

export function owned(
	resource: Record<string, unknown>,
	controllerId: string,
	allocationId?: string,
	kind?: string,
) {
	const labels = object(resource.labels);
	if (
		labels["controller-id"] !== controllerId ||
		(allocationId && labels["allocation-id"] !== allocationId) ||
		(kind && labels["resource-kind"] !== kind)
	)
		throw new ProviderError("resource_identity_mismatch", 409);
	idField(resource.id);
}

export async function verifyController(
	firewallId: number,
	controllerId: string,
) {
	const response = await request(`firewalls/${firewallId}`);
	if (!response) throw new ProviderError("project_firewall_missing", 403);
	owned(object(response.firewall), controllerId);
}

export async function resolveSpec(locations: string[], image: string) {
	const types = await request("server_types?name=cx23");
	const type = object(list(types?.server_types)[0]);
	if (type.name !== "cx23" || type.architecture !== "x86")
		throw new ProviderError("server_type_unavailable", 412);
	const supported = list(type.locations).map(object);
	const location =
		locations.find((name) =>
			supported.some(
				(item) =>
					item.name === name &&
					item.available === true &&
					item.deprecation === null,
			),
		) ??
		locations.find((name) =>
			supported.some((item) => item.name === name && item.deprecation === null),
		);
	if (!location) throw new ProviderError("capacity_unavailable", 412);
	const images = await request(
		`images?name=${encodeURIComponent(image)}&architecture=x86&type=system`,
	);
	const candidate = list(images?.images)
		.map(object)
		.find(
			(item) =>
				item.name === image &&
				item.architecture === "x86" &&
				item.status === "available" &&
				item.deprecation === null,
		);
	if (!candidate) throw new ProviderError("image_unavailable", 400);
	return { location, imageId: idField(candidate.id), serverType: "cx23" };
}
