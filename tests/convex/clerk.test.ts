import { beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { api, internal } from "../../convex/_generated/api";
import { clerkPageSize } from "../../convex/clerk";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../harness/convex-backend";

/**
 * `reconcile` reads Clerk and deletes every account Clerk no longer has, so the one thing it must
 * never do is delete an account Clerk still holds. Clerk pages its answer and filters it by the
 * accounts asked for, and a fake that answered with everything would make this test pass while the
 * real path deleted people.
 */

const setupTimeoutMs = 600_000;
const testTimeoutMs = 120_000;
const subjectSuffixBytes = 6;
const accountCount = 3;

let backend: ConvexBackend;

beforeAll(async () => {
	backend = await useConvexBackend();
}, setupTimeoutMs);

function toAccount() {
	const id = `user_${randomBytes(subjectSuffixBytes).toString("hex")}`;
	return {
		id,
		username: id.toLowerCase(),
		email: `${id}@example.com`,
		imageUrl: "https://example.com/avatar.png",
	};
}

async function readAccount(id: string) {
	return await backend.createClient(id).query(api.users.getCurrent, {});
}

test(
	"reconcile removes only the accounts Clerk no longer holds",
	async () => {
		const accounts = Array.from({ length: accountCount }, toAccount);
		for (const account of accounts) {
			backend.clerk.setUser(account);
			await backend.runAsAdmin(internal.users.store, {
				users: [
					{
						clerkUserId: account.id,
						username: account.username,
						email: account.email,
						imageUrl: account.imageUrl,
					},
				],
			});
		}
		const [gone, ...kept] = accounts;
		if (gone === undefined) {
			throw new Error("The test made no accounts.");
		}
		// Clerk deleted this one while nothing was listening, which is why reconcile exists.
		backend.clerk.removeUser(gone.id);

		await backend.runAsAdmin(internal.clerk.reconcile, {});

		expect(await readAccount(gone.id)).toBe(null);
		for (const account of kept) {
			expect(await readAccount(account.id)).toMatchObject({
				clerkUserId: account.id,
			});
		}
	},
	testTimeoutMs,
);

test(
	"reconcile reads every account when Clerk needs more than one page",
	async () => {
		// One more than a page, so Clerk answers twice and the loop has to ask for the second.
		const accounts = Array.from({ length: clerkPageSize + 1 }, toAccount);
		for (const account of accounts) {
			backend.clerk.setUser(account);
		}

		await backend.runAsAdmin(internal.clerk.reconcile, {});

		const last = accounts.at(-1);
		if (last === undefined) {
			throw new Error("The test made no accounts.");
		}
		// An account only on the second page proves the first page was not the whole answer.
		expect(await readAccount(last.id)).toMatchObject({ clerkUserId: last.id });
		for (const account of accounts) {
			backend.clerk.removeUser(account.id);
		}
	},
	testTimeoutMs,
);
