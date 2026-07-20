import { describe, expect, it } from "vitest";
import {
	BILLING_RECORD_RETENTION_YEARS,
	DELETED_BOX_RETENTION_DAYS,
	billingRecordPurgeAt,
	deletedBoxDataPatch,
	deletedBoxPurgeAt,
	retainedOperationMetadata,
	terminalCheckoutSecretPatch,
	unpaidCheckoutPurgeAt
} from "./boxRetention";

describe("box retention", () => {
	it("keeps a deleted box audit tombstone for exactly 180 days", () => {
		const deletedAt = Date.UTC(2026, 0, 1);
		expect(DELETED_BOX_RETENTION_DAYS).toBe(180);
		expect(deletedBoxPurgeAt(deletedAt)).toBe(
			Date.UTC(2026, 0, 1) + 180 * 24 * 60 * 60 * 1000
		);
	});

	it("removes secrets and dead infrastructure from the tombstone", () => {
		const deletedAt = Date.UTC(2026, 0, 1);
		expect(deletedBoxDataPatch(deletedAt)).toMatchObject({
			status: "deleted",
			runtime_image: undefined,
			runtime_auth_hash: undefined,
			password_setup_pending_at: undefined,
			hetzner_server_id: undefined,
			hetzner_ipv4: undefined,
			dns_record_id: undefined,
			deleted_at: deletedAt,
			purge_at: deletedBoxPurgeAt(deletedAt)
		});
	});

	it("removes unpaid checkout records after 30 days", () => {
		const finishedAt = Date.UTC(2026, 0, 1);
		expect(unpaidCheckoutPurgeAt(finishedAt)).toBe(Date.UTC(2026, 0, 31));
	});

	it("uses calendar years for statutory billing retention", () => {
		const finishedAt = Date.UTC(2024, 1, 29, 12);
		expect(BILLING_RECORD_RETENTION_YEARS).toBe(6);
		expect(billingRecordPurgeAt(finishedAt)).toBe(Date.UTC(2030, 2, 1, 12));
	});

	it("retains only a manual suspension reason from operation metadata", () => {
		expect(
			retainedOperationMetadata("suspend", {
				reason: "Repeated outbound abuse",
				secret: "drop-me"
			})
		).toEqual({ reason: "Repeated outbound abuse" });
		expect(
			retainedOperationMetadata("change_slug", {
				oldSlug: "old",
				newSlug: "new"
			})
		).toBeUndefined();
	});

	it("removes checkout secrets as soon as an intent becomes terminal", () => {
		expect(terminalCheckoutSecretPatch()).toEqual({
			polar_checkout_url: undefined,
			runtime_auth_hash: undefined
		});
	});
});

describe("purge sweeps", () => {
	// Convex orders a missing field below every number in an index, so
	// `lte("purge_at", now)` on an optional purge_at also selects every row that
	// never received one - live users, in-flight checkouts. That shipped: a live
	// account was found carrying a purge_at only the retry path writes, meaning
	// the sweep had already selected it. Every range over an optional purge_at
	// must be bounded from below.
	it("bounds every purge_at range query from below", async () => {
		const { readdir, readFile } = await import("node:fs/promises");
		const { join } = await import("node:path");
		const root = join(import.meta.dirname, "..");

		const walk = async (dir: string): Promise<string[]> => {
			const entries = await readdir(dir, { withFileTypes: true });
			const files = await Promise.all(
				entries.map(async (entry) => {
					const path = join(dir, entry.name);
					if (entry.isDirectory()) {
						return entry.name === "_generated" ? [] : walk(path);
					}
					return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
						? [path]
						: [];
				})
			);
			return files.flat();
		};

		const offenders: string[] = [];
		for (const file of await walk(root)) {
			const source = await readFile(file, "utf8");
			for (const match of source.matchAll(/\.lte\(\s*"purge_at"/g)) {
				// The lower bound belongs to the same range builder, so it reads a
				// short window back rather than trying to parse the expression.
				const preceding = source.slice(
					Math.max(0, match.index - 200),
					match.index
				);
				if (!preceding.includes('.gte("purge_at"')) {
					offenders.push(file.slice(root.length + 1));
				}
			}
		}

		expect(offenders).toEqual([]);
	});
});
