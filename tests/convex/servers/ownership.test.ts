import { beforeAll, expect, test } from "bun:test";
import { api, internal } from "../../../convex/_generated/api";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../../harness/convex/backend";
import { cleanupTestServer } from "../../../harness/servers";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 300_000;

let backend: ConvexBackend;

beforeAll(async () => {
	backend = await useConvexBackend();
}, setupTimeoutMs);

test(
	"ownership transfer moves quota usage and fences a stale recount",
	async () => {
		const firstAccount = await backend.createAccount();
		const secondAccount = await backend.createAccount();
		const firstClient = backend.createClient(firstAccount.id);
		const secondClient = backend.createClient(secondAccount.id);
		const firstUser = await firstClient.query(api.users.getCurrent, {});
		const secondUser = await secondClient.query(api.users.getCurrent, {});
		if (
			firstUser === null ||
			secondUser === null ||
			secondAccount.email === undefined
		) {
			throw new Error("The test accounts did not sync.");
		}
		for (const userId of [firstUser._id, secondUser._id]) {
			await backend.runAsAdmin(internal.quotas.set, {
				userId,
				kind: "server",
				limit: 1,
			});
		}
		await backend.runAsAdmin(internal.quotas.set, {
			kind: "server",
			limit: 10,
		});

		const created = await firstClient.mutation(api.servers.lifecycle.create, {
			name: `transfer-${crypto.randomUUID()}`,
			requestId: crypto.randomUUID(),
		});
		if (!created.ok) {
			throw new Error(`Creating the server failed: ${created.code}`);
		}
		const serverId = created.serverId;
		const beforeTransfer = await backend.runAsAdmin(
			internal.quotas.readHeldPage,
			{ kind: "server", cursor: null },
		);

		const added = await firstClient.mutation(api.servers.memberships.add, {
			serverId,
			email: secondAccount.email,
		});
		expect(added).toMatchObject({ ok: true });
		const members = await firstClient.query(api.servers.memberships.list, {
			serverId,
			paginationOpts: { numItems: 100, cursor: null },
		});
		const secondMembership = members.page.find(
			(member) => member.userId === secondUser._id,
		);
		if (secondMembership === undefined) {
			throw new Error("The transfer target was not added.");
		}

		await backend.runAsAdmin(internal.quotas.set, {
			userId: secondUser._id,
			kind: "server",
			limit: 0,
		});
		await expect(
			firstClient.mutation(api.servers.ownership.transfer, {
				membershipId: secondMembership._id,
			}),
		).rejects.toMatchObject({
			data: { code: "server_quota_reached" },
		});
		const ownerAfterRefusedTransfer = await firstClient.query(
			api.servers.ownership.getOwner,
			{ serverId },
		);
		expect(ownerAfterRefusedTransfer?.userId).toBe(firstUser._id);
		const afterRefusedTransfer = await backend.runAsAdmin(
			internal.quotas.readHeldPage,
			{ kind: "server", cursor: null },
		);
		expect(afterRefusedTransfer.epoch).toBe(beforeTransfer.epoch);

		await backend.runAsAdmin(internal.quotas.set, {
			userId: secondUser._id,
			kind: "server",
			limit: 1,
		});
		await firstClient.mutation(api.servers.ownership.transfer, {
			membershipId: secondMembership._id,
		});
		const afterTransfer = await backend.runAsAdmin(
			internal.quotas.readHeldPage,
			{ kind: "server", cursor: null },
		);
		expect(afterTransfer.epoch).toBeGreaterThan(beforeTransfer.epoch);
		expect(
			await backend.runAsAdmin(internal.quotas.applyReconciliation, {
				kind: "server",
				limit: 10,
				used: beforeTransfer.used,
				epoch: beforeTransfer.epoch,
			}),
		).toBe(false);

		const refusedForSecondOwner = await secondClient.mutation(
			api.servers.lifecycle.create,
			{ name: `full-${crypto.randomUUID()}`, requestId: crypto.randomUUID() },
		);
		expect(refusedForSecondOwner).toMatchObject({
			ok: false,
			code: "server_quota_reached",
		});
		const secondServer = await firstClient.mutation(
			api.servers.lifecycle.create,
			{ name: `free-${crypto.randomUUID()}`, requestId: crypto.randomUUID() },
		);
		if (!secondServer.ok) {
			throw new Error(
				`Creating the transferred owner's server failed: ${secondServer.code}`,
			);
		}

		const ownerAfterTransfer = await secondClient.query(
			api.servers.ownership.getOwner,
			{ serverId },
		);
		if (ownerAfterTransfer === null) {
			throw new Error("The transferred server has no owner.");
		}
		const firstMembership = (
			await secondClient.query(api.servers.memberships.list, {
				serverId,
				paginationOpts: { numItems: 100, cursor: null },
			})
		).page.find((member) => member.userId === firstUser._id);
		if (firstMembership === undefined) {
			throw new Error("The previous owner was not made a member.");
		}
		expect(firstMembership.permissions.manageMembers).toBe(true);
		expect(ownerAfterTransfer.userId).toBe(secondUser._id);

		const firstEpoch = await backend.runAsAdmin(internal.users.issueUserEpoch, {
			clerkUserId: firstAccount.id,
		});
		if (firstEpoch === null) {
			throw new Error("The original owner was already removed.");
		}
		await backend.runAsAdmin(internal.users.remove, {
			clerkUserIds: [firstAccount.id],
			epoch: firstEpoch,
		});
		await cleanupTestServer(backend, secondServer.serverId);
		await cleanupTestServer(backend, serverId);
	},
	testTimeoutMs,
);
