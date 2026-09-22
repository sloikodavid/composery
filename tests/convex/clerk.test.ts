import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { api, internal } from "../../convex/_generated/api";
import { clerkPageSize } from "../../convex/clerk";
import { getClerkSecret } from "../../harness/clerk/real";
import {
	type ConvexBackend,
	startConvexBackend,
} from "../../harness/convex/backend";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 120_000;
const subjectSuffixBytes = 6;
const accountCount = 3;
const httpOk = 200;
const serviceUnavailable = 503;
// Reconcile must not delete a Clerk account from a short or malformed list response.
const accountsAskedAbout = /^\/users\?.*user_id=/;

const scripted = test.skipIf(getClerkSecret() !== null);

let backend: ConvexBackend;

const resources = new AsyncDisposableStack();

beforeAll(async () => {
	backend = await startConvexBackend();
	resources.defer(backend.stop);
}, setupTimeoutMs);

function toAccount(hasPicture = true) {
	const id = `user_${randomBytes(subjectSuffixBytes).toString("hex")}`;
	return {
		id,
		email: `${id}@example.com`,
		...(hasPicture ? { imageUrl: "https://example.com/avatar.png" } : {}),
	};
}

async function readAccount(id: string) {
	return await backend.createClient(id).query(api.users.getCurrent, {});
}

async function storeAccount(user: {
	clerkUserId: string;
	email?: string;
	imageUrl?: string;
}) {
	const epoch = await backend.runAsAdmin(internal.users.issueListEpoch, {});
	await backend.runAsAdmin(internal.users.store, { users: [user], epoch });
}

async function issueUserEpoch(clerkUserId: string) {
	return await backend.runAsAdmin(internal.users.issueUserEpoch, {
		clerkUserId,
	});
}

test(
	"an older sync result cannot replace a newer result, and a failed newer read does not discard an older result",
	async () => {
		const account = await backend.createAccount();
		await storeAccount({ clerkUserId: account.id, email: "old@example.com" });
		const staleListEpoch = await backend.runAsAdmin(
			internal.users.issueListEpoch,
			{},
		);
		const pendingEpoch = await issueUserEpoch(account.id);
		if (pendingEpoch === null) {
			throw new Error("The test could not start the list-ordering sync.");
		}
		await backend.runAsAdmin(internal.users.store, {
			users: [{ clerkUserId: account.id, email: "direct@example.com" }],
			epoch: pendingEpoch,
		});
		await backend.runAsAdmin(internal.users.store, {
			users: [{ clerkUserId: account.id, email: "stale-list@example.com" }],
			epoch: staleListEpoch,
		});
		expect((await readAccount(account.id))?.email).toBe("direct@example.com");
		const firstEpoch = await issueUserEpoch(account.id);
		const secondEpoch = await issueUserEpoch(account.id);
		if (firstEpoch === null || secondEpoch === null) {
			throw new Error("The test could not start a user sync.");
		}
		await backend.runAsAdmin(internal.users.store, {
			users: [{ clerkUserId: account.id, email: "new@example.com" }],
			epoch: secondEpoch,
		});
		await backend.runAsAdmin(internal.users.store, {
			users: [{ clerkUserId: account.id, email: "old@example.com" }],
			epoch: firstEpoch,
		});
		expect((await readAccount(account.id))?.email).toBe("new@example.com");

		const olderSuccessfulEpoch = await issueUserEpoch(account.id);
		const failedNewerEpoch = await issueUserEpoch(account.id);
		if (failedNewerEpoch === null || olderSuccessfulEpoch === null) {
			throw new Error("The test could not start the second user sync pair.");
		}
		await backend.runAsAdmin(internal.users.store, {
			users: [{ clerkUserId: account.id, email: "recovered@example.com" }],
			epoch: olderSuccessfulEpoch,
		});
		expect((await readAccount(account.id))?.email).toBe(
			"recovered@example.com",
		);
	},
	testTimeoutMs,
);

test(
	"a confirmed deletion remains after every older sync result",
	async () => {
		const account = await backend.createAccount();
		const oldEpoch = await issueUserEpoch(account.id);
		const deleteEpoch = await issueUserEpoch(account.id);
		if (oldEpoch === null || deleteEpoch === null) {
			throw new Error("The test could not start a deletion sync.");
		}
		await backend.runAsAdmin(internal.users.remove, {
			clerkUserIds: [account.id],
			epoch: deleteEpoch,
		});
		await backend.runAsAdmin(internal.users.store, {
			users: [{ clerkUserId: account.id, email: "stale@example.com" }],
			epoch: oldEpoch,
		});
		expect(await readAccount(account.id)).toBe(null);
	},
	testTimeoutMs,
);

test(
	"a deletion of an unseen account fences an older in-flight result",
	async () => {
		const account = toAccount();
		const oldEpoch = await issueUserEpoch(account.id);
		const deleteEpoch = await issueUserEpoch(account.id);
		if (oldEpoch === null || deleteEpoch === null) {
			throw new Error("The test could not start an unseen-account deletion.");
		}
		await backend.runAsAdmin(internal.users.remove, {
			clerkUserIds: [account.id],
			epoch: deleteEpoch,
		});
		await backend.runAsAdmin(internal.users.store, {
			users: [{ clerkUserId: account.id, email: account.email }],
			epoch: oldEpoch,
		});
		expect(
			await backend.runAsAdmin(internal.users.isSynced, {
				clerkUserId: account.id,
			}),
		).toBe(false);
	},
	testTimeoutMs,
);

scripted(
	"reconcile removes only the accounts Clerk no longer holds",
	async () => {
		const accounts = Array.from({ length: accountCount }, toAccount);
		for (const account of accounts) {
			backend.clerk.setUser(account);
			await storeAccount({
				clerkUserId: account.id,
				email: account.email,
				...(account.imageUrl === undefined
					? {}
					: { imageUrl: account.imageUrl }),
			});
		}
		const [gone, ...kept] = accounts;
		if (gone === undefined) {
			throw new Error("The test made no accounts.");
		}
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

scripted(
	"reconcile reads every account when Clerk needs more than one page",
	async () => {
		// One more than a page proves the pagination loop continues.
		const accounts = Array.from({ length: clerkPageSize + 1 }, toAccount);
		for (const account of accounts) {
			backend.clerk.setUser(account);
		}

		await backend.runAsAdmin(internal.clerk.reconcile, {});

		const last = accounts.at(-1);
		if (last === undefined) {
			throw new Error("The test made no accounts.");
		}
		expect(await readAccount(last.id)).toMatchObject({ clerkUserId: last.id });
		for (const account of accounts) {
			backend.clerk.removeUser(account.id);
		}
	},
	testTimeoutMs,
);

scripted(
	"an account with no picture is stored, and does not stop the rest being read",
	async () => {
		const withPicture = toAccount();
		const withoutPicture = toAccount(false);
		for (const account of [withoutPicture, withPicture]) {
			backend.clerk.setUser(account);
		}

		await backend.runAsAdmin(internal.clerk.reconcile, {});

		const stored = await readAccount(withoutPicture.id);
		expect(stored).toMatchObject({ clerkUserId: withoutPicture.id });
		expect(stored?.imageUrl).toBeNull();
		expect(await readAccount(withPicture.id)).toMatchObject({
			clerkUserId: withPicture.id,
		});
		for (const account of [withoutPicture, withPicture]) {
			backend.clerk.removeUser(account.id);
		}
	},
	testTimeoutMs,
);

scripted(
	"an account with no email address is kept, and can use the app",
	async () => {
		// Clerk permits accounts without a primary email.
		const { email: _, ...account } = toAccount();
		backend.clerk.setUser(account);

		await backend.runAsAdmin(internal.clerk.reconcile, {});

		const stored = await readAccount(account.id);
		expect(stored).toMatchObject({ clerkUserId: account.id });
		expect(stored?.email).toBeNull();
		backend.clerk.removeUser(account.id);
	},
	testTimeoutMs,
);

scripted(
	"an address removed at Clerk is removed here, so nobody is found by an address they gave up",
	async () => {
		const account = toAccount();
		backend.clerk.setUser(account);
		await backend.runAsAdmin(internal.clerk.reconcile, {});
		expect((await readAccount(account.id))?.email).toBe(account.email);

		const { email: _, ...moved } = account;
		backend.clerk.setUser(moved);
		await backend.runAsAdmin(internal.clerk.reconcile, {});

		expect((await readAccount(account.id))?.email).toBeNull();
		backend.clerk.removeUser(account.id);
	},
	testTimeoutMs,
);

scripted(
	"reconcile keeps an account that a short list left out, when Clerk still has it",
	async () => {
		const account = toAccount();
		backend.clerk.setUser(account);
		await backend.runAsAdmin(internal.clerk.reconcile, {});
		const hasShortened = backend.clerk.scriptOnce(
			{
				method: "GET",
				path: new RegExp(`${accountsAskedAbout.source}.*${account.id}`),
			},
			{ kind: "uncheckedReply", reply: { status: httpOk, body: [] } },
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

scripted(
	"reconcile goes past an account Clerk cannot answer for, and still fails",
	async () => {
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
			{ kind: "uncheckedReply", reply: { status: httpOk, body: [] } },
		);
		const hasRefused = backend.clerk.scriptOnce(
			{ method: "GET", path: new RegExp(`^/users/${unanswered.id}$`) },
			{
				kind: "uncheckedReply",
				reply: { status: serviceUnavailable, body: null },
			},
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

afterAll(() => resources.disposeAsync(), setupTimeoutMs);
