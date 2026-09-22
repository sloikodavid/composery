import { expect, test } from "bun:test";
import { type ApiFromModules, anyApi } from "convex/server";
import { api, internal } from "../../convex/_generated/api";
import { startConvexBackend } from "../../harness/convex/backend";
import type * as quotaWrites from "../../harness/convex/quota-writes";

const fixtures = anyApi as unknown as ApiFromModules<{
	// biome-ignore lint/style/useNamingConvention: the disposable Convex module uses a snake_case file name
	test_quotas: typeof quotaWrites;
}>;
const testTimeoutMs = 600_000;

test(
	"every database write accounts for usage and a caught failure still rolls back",
	async () => {
		await using resources = new AsyncDisposableStack();
		const backend = await startConvexBackend();
		resources.defer(backend.stop);
		const account = await backend.createAccount();
		const client = backend.createClient(account.id);
		const user = await client.query(api.users.getCurrent, {});
		if (user === null) {
			throw new Error("The test user did not sync.");
		}
		await backend.runAsAdmin(internal.servers.quotas.set, {
			userId: user._id,
			limit: 1,
		});
		// The user has capacity, so the deployment refusal follows the first count update.
		await expect(
			backend.runAsAdmin(fixtures.test_quotas.write, {
				change: { kind: "catchInsertFailure", userId: user._id },
			}),
		).rejects.toMatchObject({ data: { code: "server_capacity_unavailable" } });
		expect(
			await backend.runAsAdmin(internal.servers.quotas.get, {
				userId: user._id,
			}),
		).toEqual({ limit: 1, used: 0 });
		expect(
			(
				await client.query(api.servers.ownership.listMine, {
					paginationOpts: { numItems: 10, cursor: null },
				})
			).page,
		).toEqual([]);
		await backend.runAsAdmin(internal.servers.quotas.set, { limit: 1 });
		const serverId = await backend.runAsAdmin(fixtures.test_quotas.write, {
			change: { kind: "insert", userId: user._id },
		});
		if (serverId === null) {
			throw new Error("The test server was not inserted.");
		}
		const recipientAccount = await backend.createAccount();
		const recipient = await backend
			.createClient(recipientAccount.id)
			.query(api.users.getCurrent, {});
		if (recipient === null) {
			throw new Error("The recipient did not sync.");
		}
		await backend.runAsAdmin(internal.servers.quotas.set, {
			userId: recipient._id,
			limit: 1,
		});
		for (const kind of ["patch", "replace"] as const) {
			await backend.runAsAdmin(fixtures.test_quotas.write, {
				change: { kind, serverId, userId: recipient._id },
			});
			expect(
				await backend.runAsAdmin(internal.servers.quotas.get, {
					userId: recipient._id,
				}),
			).toEqual({ limit: 1, used: 1 });
			expect(
				await backend.runAsAdmin(internal.servers.quotas.get, {
					userId: user._id,
				}),
			).toEqual({ limit: 1, used: 0 });
			await backend.runAsAdmin(fixtures.test_quotas.write, {
				change: { kind, serverId, userId: user._id },
			});
		}
		expect(await backend.runAsAdmin(internal.servers.quotas.get, {})).toEqual({
			limit: 1,
			used: 1,
		});
		expect(
			await backend.runAsAdmin(internal.servers.quotas.get, {
				userId: user._id,
			}),
		).toEqual({ limit: 1, used: 1 });
		await backend.runAsAdmin(fixtures.test_quotas.write, {
			change: { kind: "delete", serverId },
		});
		expect(await backend.runAsAdmin(internal.servers.quotas.get, {})).toEqual({
			limit: 1,
			used: 0,
		});
		expect(
			await backend.runAsAdmin(internal.servers.quotas.get, {
				userId: user._id,
			}),
		).toEqual({ limit: 1, used: 0 });
	},
	testTimeoutMs,
);
