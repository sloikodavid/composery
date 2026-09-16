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
const httpOk = 200;
const serviceUnavailable = 503;
// The list of named accounts, and not their count, which asks with the same query.
const accountsAskedAbout = /^\/users\?.*user_id=/;

let backend: ConvexBackend;

beforeAll(async () => {
	backend = await useConvexBackend();
}, setupTimeoutMs);

function toAccount(hasPicture = true) {
	const id = `user_${randomBytes(subjectSuffixBytes).toString("hex")}`;
	return {
		id,
		username: id.toLowerCase(),
		email: `${id}@example.com`,
		// Clerk leaves the member out for an account with no picture; it does not send an empty one.
		...(hasPicture ? { imageUrl: "https://example.com/avatar.png" } : {}),
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
						imageUrl: account.imageUrl ?? "",
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

test(
	"an account with no picture is stored, and does not stop the rest being read",
	async () => {
		const withPicture = toAccount();
		const withoutPicture = toAccount(false);
		// Clerk requires `has_image` and not `image_url`. Reading a missing picture as a missing
		// account would refuse this one, and take every account after it in the same run with it.
		for (const account of [withoutPicture, withPicture]) {
			backend.clerk.setUser(account);
		}

		await backend.runAsAdmin(internal.clerk.reconcile, {});

		const stored = await readAccount(withoutPicture.id);
		expect(stored).toMatchObject({ clerkUserId: withoutPicture.id });
		// Absent, as Clerk sent it, and not an empty string standing in for one.
		expect(stored?.imageUrl).toBeUndefined();
		expect(await readAccount(withPicture.id)).toMatchObject({
			clerkUserId: withPicture.id,
		});
		for (const account of [withoutPicture, withPicture]) {
			backend.clerk.removeUser(account.id);
		}
	},
	testTimeoutMs,
);

test(
	"an account without a username is kept, and can use the app",
	async () => {
		// Clerk's own documentation shows a completed account with a null username. Keeping it out
		// would lock somebody out of their own servers over a field that only exists to find people.
		const { username: _, ...account } = toAccount();
		backend.clerk.setUser(account);

		await backend.runAsAdmin(internal.clerk.reconcile, {});

		const stored = await readAccount(account.id);
		expect(stored).toMatchObject({ clerkUserId: account.id });
		expect(stored?.username).toBeUndefined();
		backend.clerk.removeUser(account.id);
	},
	testTimeoutMs,
);

test(
	"a username removed at Clerk is removed here, so nobody can be found by a name they gave up",
	async () => {
		const account = toAccount();
		backend.clerk.setUser(account);
		await backend.runAsAdmin(internal.clerk.reconcile, {});
		expect((await readAccount(account.id))?.username).toBe(account.username);

		const { username: _, ...renamed } = account;
		backend.clerk.setUser(renamed);
		await backend.runAsAdmin(internal.clerk.reconcile, {});

		expect((await readAccount(account.id))?.username).toBeUndefined();
		backend.clerk.removeUser(account.id);
	},
	testTimeoutMs,
);

test(
	"reconcile keeps an account that a short list left out, when Clerk still has it",
	async () => {
		const account = toAccount();
		backend.clerk.setUser(account);
		await backend.runAsAdmin(internal.clerk.reconcile, {});
		// The list of accounts asked about comes back without this one. Removing somebody deletes
		// every server they own, so a list that says less than it should is not enough to do it.
		const hasShortened = backend.clerk.scriptOnce(
			{
				method: "GET",
				path: new RegExp(`${accountsAskedAbout.source}.*${account.id}`),
			},
			{ status: httpOk, body: [] },
		);

		await backend.runAsAdmin(internal.clerk.reconcile, {});

		expect(hasShortened()).toBe(true);
		expect(await readAccount(account.id)).toMatchObject({
			clerkUserId: account.id,
		});
		backend.clerk.removeUser(account.id);
	},
	testTimeoutMs,
);

test(
	"reconcile goes past an account Clerk cannot answer for, and still fails",
	async () => {
		// Stored in this order, so the account Clerk cannot answer for is checked first.
		const unanswered = toAccount();
		const gone = toAccount();
		backend.clerk.setUser(unanswered);
		backend.clerk.setUser(gone);
		await backend.runAsAdmin(internal.clerk.reconcile, {});
		backend.clerk.removeUser(gone.id);
		const hasShortened = backend.clerk.scriptOnce(
			{
				method: "GET",
				path: new RegExp(`${accountsAskedAbout.source}.*${unanswered.id}`),
			},
			{ status: httpOk, body: [] },
		);
		const hasRefused = backend.clerk.scriptOnce(
			{ method: "GET", path: new RegExp(`^/users/${unanswered.id}$`) },
			{ status: serviceUnavailable, body: null },
		);

		const outcome = await backend.runAsAdmin(internal.clerk.reconcile, {}).then(
			() => "finished",
			() => "failed",
		);

		expect(hasShortened()).toBe(true);
		expect(hasRefused()).toBe(true);
		expect(outcome).toBe("failed");
		expect(await readAccount(unanswered.id)).toMatchObject({
			clerkUserId: unanswered.id,
		});
		expect(await readAccount(gone.id)).toBe(null);
		backend.clerk.removeUser(unanswered.id);
	},
	testTimeoutMs,
);
