import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { requiredEnv, runtimeDomain } from "../../env";

type CloudflareResponse<T> = {
	errors?: Array<{ message?: string }>;
	result?: T;
	success?: boolean;
};

type CloudflareDnsRecord = {
	content?: string;
	id: string;
	name?: string;
	type?: string;
};

export class CloudflareApiError extends Error {
	constructor(
		message: string,
		public readonly status: number
	) {
		super(message);
		this.name = "CloudflareApiError";
	}
}

function cloudflareHeaders() {
	return {
		Authorization: `Bearer ${requiredEnv("CLOUDFLARE_DNS_TOKEN")}`,
		"Content-Type": "application/json"
	};
}

async function cloudflareRequest<T>(path: string, init?: RequestInit) {
	const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
		...init,
		headers: {
			...cloudflareHeaders(),
			...init?.headers
		}
	});
	const text = await response.text();
	const body = text
		? (JSON.parse(text) as CloudflareResponse<T>)
		: ({ success: response.ok } as CloudflareResponse<T>);

	if (!response.ok || body.success === false) {
		throw new CloudflareApiError(
			body.errors
				?.map((error) => error.message)
				.filter(Boolean)
				.join("; ") || `Cloudflare API ${response.status}.`,
			response.status
		);
	}

	return body.result as T;
}

function isNotFound(error: unknown) {
	return error instanceof CloudflareApiError && error.status === 404;
}

export function dnsRecordListPath(
	zoneId: string,
	type: "A" | "AAAA",
	name: string
) {
	const params = new URLSearchParams({
		match: "all",
		"name.exact": name,
		per_page: "100",
		type
	});
	return `/zones/${zoneId}/dns_records?${params.toString()}`;
}

export function dnsRecordPayload(
	type: "A" | "AAAA",
	name: string,
	content: string
) {
	return {
		type,
		name,
		content,
		ttl: 1,
		proxied: false
	};
}

async function listDnsRecords(
	zoneId: string,
	type: "A" | "AAAA",
	name: string
) {
	return await cloudflareRequest<CloudflareDnsRecord[]>(
		dnsRecordListPath(zoneId, type, name)
	);
}

async function ensureDnsRecord(
	zoneId: string,
	type: "A" | "AAAA",
	name: string,
	content: string
) {
	const records = await listDnsRecords(zoneId, type, name);
	const matching = records.find((record) => record.content === content);
	if (matching) return matching;

	const payload = dnsRecordPayload(type, name, content);
	const reusable = records[0];
	if (reusable) {
		return await cloudflareRequest<CloudflareDnsRecord>(
			`/zones/${zoneId}/dns_records/${reusable.id}`,
			{
				method: "PATCH",
				body: JSON.stringify(payload)
			}
		);
	}

	return await cloudflareRequest<CloudflareDnsRecord>(
		`/zones/${zoneId}/dns_records`,
		{
			method: "POST",
			body: JSON.stringify(payload)
		}
	);
}

async function deleteCloudflareRecord(zoneId: string, id: string) {
	try {
		await cloudflareRequest<{ id: string }>(
			`/zones/${zoneId}/dns_records/${id}`,
			{ method: "DELETE" }
		);
	} catch (error) {
		if (!isNotFound(error)) throw error;
	}
}

export const createRuntimeDnsRecords = internalAction({
	args: {
		ipv4: v.string(),
		ipv6: v.string(),
		slug: v.string()
	},
	handler: async (_ctx, args) => {
		const zoneId = requiredEnv("CLOUDFLARE_ZONE_ID");
		const name = runtimeDomain(args.slug);
		let aRecordId: string | undefined;

		try {
			const aRecord = await ensureDnsRecord(zoneId, "A", name, args.ipv4);
			aRecordId = aRecord.id;
			const aaaaRecord = await ensureDnsRecord(zoneId, "AAAA", name, args.ipv6);

			return {
				aRecordId: aRecord.id,
				aaaaRecordId: aaaaRecord.id
			};
		} catch (error) {
			if (aRecordId) {
				await deleteCloudflareRecord(zoneId, aRecordId).catch(() => undefined);
			}
			throw error;
		}
	}
});

export const deleteRuntimeDnsRecords = internalAction({
	args: {
		aRecordId: v.optional(v.string()),
		aaaaRecordId: v.optional(v.string())
	},
	handler: async (_ctx, args) => {
		const zoneId = requiredEnv("CLOUDFLARE_ZONE_ID");
		const ids = new Set(
			[args.aRecordId, args.aaaaRecordId].filter((id): id is string =>
				Boolean(id)
			)
		);

		for (const id of ids) {
			await deleteCloudflareRecord(zoneId, id);
		}
	}
});
