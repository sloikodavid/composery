import { type Infer, v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
	env,
	internalMutation,
	internalQuery,
	type MutationCtx,
	type QueryCtx,
} from "../_generated/server";
import schema from "../schema";
import type { sshTables } from "./schema";

// Canonical base64 of exactly 32 bytes.
const encryptionKeyPattern = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/;
const hexRadix = 16;

type AllocationSshAccessFields = Infer<
	typeof sshTables.allocationSshAccess.validator
>;

export function isSshAccessEncryptionKey(value: string) {
	return encryptionKeyPattern.test(value);
}

/** Throws when the encryption key is set but invalid. */
export function isSshAccessConfigured() {
	const value = env.SSH_ACCESS_ENCRYPTION_KEY;
	if (!value) {
		return false;
	}
	if (!isSshAccessEncryptionKey(value)) {
		throw new Error("SSH_ACCESS_ENCRYPTION_KEY is not base64 of 32 bytes.");
	}
	return true;
}

export const bootstrapLifetimeMs = 900_000;
const ipv6GroupPattern = /^[0-9a-fA-F]{1,4}$/;
const ipv6Groups = 8;
const ipv6GroupBits = 16;
const ipv6Bits = ipv6Groups * ipv6GroupBits;

function toIpv6Number(address: string) {
	const [head, tail] = address.split("::");
	const left = head === undefined || head === "" ? [] : head.split(":");
	const right = tail === undefined || tail === "" ? [] : tail.split(":");
	const groups =
		tail === undefined
			? left
			: [
					...left,
					...Array(ipv6Groups - left.length - right.length).fill("0"),
					...right,
				];
	if (groups.length !== ipv6Groups) {
		return null;
	}
	let value = 0n;
	for (const group of groups) {
		if (!ipv6GroupPattern.test(group)) {
			return null;
		}
		value = (value << BigInt(ipv6GroupBits)) + BigInt(`0x${group}`);
	}
	return value;
}

/** Hetzner states an IPv6 address as a network, so any address inside it is the machine. */
function isInIpv6Network(source: string, network: string) {
	const [prefix, length] = network.split("/");
	const bits = Number(length ?? ipv6Bits);
	const networkValue = prefix === undefined ? null : toIpv6Number(prefix);
	const sourceValue = toIpv6Number(source);
	if (
		networkValue === null ||
		sourceValue === null ||
		!Number.isInteger(bits) ||
		bits < 1 ||
		bits > ipv6Bits
	) {
		return false;
	}
	const mask = ((1n << BigInt(bits)) - 1n) << BigInt(ipv6Bits - bits);
	return (networkValue & mask) === (sourceValue & mask);
}

function isAllocationAddress(
	source: string,
	allocation: { ipv4?: string; ipv6?: string },
) {
	if (allocation.ipv4 === undefined && allocation.ipv6 === undefined) {
		return null;
	}
	return (
		source === allocation.ipv4 ||
		(allocation.ipv6 !== undefined && isInIpv6Network(source, allocation.ipv6))
	);
}

export async function toBootstrapTokenDigest(token: string) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(token),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(hexRadix).padStart(2, "0"),
	).join("");
}

export async function getAllocationSshAccess(
	ctx: QueryCtx,
	allocationId: Id<"serverAllocations">,
) {
	return await ctx.db
		.query("allocationSshAccess")
		.withIndex("by_allocation_id", (q) => q.eq("allocationId", allocationId))
		.unique();
}

export async function deleteAllocationSshAccess(
	ctx: MutationCtx,
	allocationId: Id<"serverAllocations">,
) {
	const sshAccess = await getAllocationSshAccess(ctx, allocationId);
	if (sshAccess !== null) {
		await ctx.db.delete("allocationSshAccess", sshAccess._id);
	}
}

/**
 * Keeps access that cloud-init can already hold, and replaces only an expired
 * bootstrap without a registered host key. The caller must confirm that the
 * server was not requested yet.
 */
export async function storeAllocationSshAccess(
	ctx: MutationCtx,
	fields: AllocationSshAccessFields,
) {
	const existing = await getAllocationSshAccess(ctx, fields.allocationId);
	if (existing === null) {
		const id = await ctx.db.insert("allocationSshAccess", fields);
		const inserted = await ctx.db.get("allocationSshAccess", id);
		if (inserted === null) {
			throw new Error("The SSH access that was inserted is missing.");
		}
		return inserted;
	}
	if (
		existing.bootstrapExpiresAt > Date.now() ||
		existing.hostKey !== undefined
	) {
		return existing;
	}
	await ctx.db.replace("allocationSshAccess", existing._id, fields);
	return {
		...fields,
		_id: existing._id,
		_creationTime: existing._creationTime,
	};
}

/** Opens one bootstrap window: the next report from the machine may replace the pinned host key. */
export const storeBootstrap = internalMutation({
	args: {
		allocationId: v.id("serverAllocations"),
		encryptedSecrets: v.string(),
		bootstrapTokenDigest: v.string(),
	},
	returns: v.null(),
	handler: async (ctx, { allocationId, ...secrets }) => {
		const sshAccess = await getAllocationSshAccess(ctx, allocationId);
		if (sshAccess === null) {
			throw new Error("The allocation has no SSH access.");
		}
		const until = Date.now() + bootstrapLifetimeMs;
		await ctx.db.patch("allocationSshAccess", sshAccess._id, {
			...secrets,
			bootstrapExpiresAt: until,
			hostKeyReplaceUntil: until,
		});
		return null;
	},
});

export const get = internalQuery({
	args: { allocationId: v.id("serverAllocations") },
	returns: v.union(schema.doc("allocationSshAccess"), v.null()),
	handler: async (ctx, { allocationId }) =>
		await getAllocationSshAccess(ctx, allocationId),
});

/**
 * A repeated report confirms the pinned host key. A different key replaces it only inside a new
 * bootstrap window that a member opened; otherwise it is refused and recorded as a conflict.
 */
export const registerHostKey = internalMutation({
	args: {
		allocationId: v.string(),
		bootstrapTokenDigest: v.string(),
		hostKey: v.string(),
		port: v.union(v.number(), v.null()),
		source: v.union(v.string(), v.null()),
	},
	returns: v.boolean(),
	handler: async (
		ctx,
		{ allocationId, bootstrapTokenDigest, hostKey, port, source },
	) => {
		const id = ctx.db.normalizeId("serverAllocations", allocationId);
		const allocation =
			id === null ? null : await ctx.db.get("serverAllocations", id);
		const sshAccess =
			id === null ? null : await getAllocationSshAccess(ctx, id);
		if (
			allocation === null ||
			allocation.deleteRequested ||
			sshAccess === null ||
			sshAccess.bootstrapExpiresAt <= Date.now() ||
			sshAccess.bootstrapTokenDigest !== bootstrapTokenDigest
		) {
			return false;
		}
		// A copied bootstrap token is useless from anywhere but the machine's own addresses.
		if (source !== null && isAllocationAddress(source, allocation) === false) {
			await ctx.db.patch("allocationSshAccess", sshAccess._id, {
				hostKeyConflictAt: Date.now(),
			});
			return false;
		}
		const isBootstrapOpen = (sshAccess.hostKeyReplaceUntil ?? 0) > Date.now();
		if (
			sshAccess.hostKey !== undefined &&
			sshAccess.hostKey !== hostKey &&
			!isBootstrapOpen
		) {
			// Two machines answered for one allocation: a copied bootstrap token, or a replacement.
			await ctx.db.patch("allocationSshAccess", sshAccess._id, {
				hostKeyConflictAt: Date.now(),
			});
			return false;
		}
		await ctx.db.patch("allocationSshAccess", sshAccess._id, {
			hostKey,
			hostKeyConflictAt: undefined,
			hostKeyReplaceUntil: undefined,
			...(source === null ? {} : { hostKeySource: source }),
			...(port === null ? {} : { port }),
		});
		return true;
	},
});
