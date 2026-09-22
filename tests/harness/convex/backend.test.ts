import { expect, test } from "bun:test";
import { api, internal } from "../../../convex/_generated/api";
import { startConvexBackend } from "../../../harness/convex/backend";

const testTimeoutMs = 600_000;

test(
	"backend environments have separate data, providers, secrets, and shutdown",
	async () => {
		await using resources = new AsyncDisposableStack();
		const first = await startConvexBackend();
		resources.defer(first.stop);
		const second = await startConvexBackend();
		resources.defer(second.stop);
		expect(first.url).not.toBe(second.url);
		expect(first.clerk.url).not.toBe(second.clerk.url);
		expect(first.hetzner.url).not.toBe(second.hetzner.url);
		expect(first.webhookSecret).not.toBe(second.webhookSecret);
		expect(first.sshAccessEncryptionKeys).not.toEqual(
			second.sshAccessEncryptionKeys,
		);
		const account = await first.createAccount();
		expect(
			await first.createClient(account.id).query(api.users.getCurrent, {}),
		).not.toBeNull();
		expect(
			await second.runAsAdmin(internal.users.isSynced, {
				clerkUserId: account.id,
			}),
		).toBe(false);
		await first.stop();
		await first.stop();
		await expect(fetch(`${first.url}/version`)).rejects.toThrow();
		await expect(fetch(`${first.clerk.url}/v1/users`)).rejects.toThrow();
		await expect(fetch(`${first.hetzner.url}/v1/servers`)).rejects.toThrow();
		expect((await fetch(`${second.url}/version`)).ok).toBe(true);
	},
	testTimeoutMs,
);
