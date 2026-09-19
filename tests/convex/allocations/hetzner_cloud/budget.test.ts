import { beforeAll, expect, test } from "bun:test";
import {
	type ConvexBackend,
	useConvexBackend,
} from "../../../../harness/convex/backend";
import {
	type HetznerFake,
	useHetznerFake,
} from "../../../../harness/hetzner/fake";
import {
	createServer,
	createServerOwner,
	readServerBackendRecord,
} from "../../../../harness/servers";

const setupTimeoutMs = 600_000;
const testTimeoutMs = 300_000;
const waitDelayMs = 250;
const httpOk = 200;
const secondsPerMinute = 60;
const millisecondsPerSecond = 1000;
// Long enough that no ordinary delay could be mistaken for it: the worker's own waits are
// seconds, and an hour's budget is what this one is about.
const minutesUntilReset = 30;
const resetInSeconds = minutesUntilReset * secondsPerMinute;
const createdPrimaryIps = /^\/primary_ips$/;

let backend: ConvexBackend;
let fake: HetznerFake;

beforeAll(async () => {
	backend = await useConvexBackend();
	fake = await useHetznerFake();
}, setupTimeoutMs);

test(
	"an hour Hetzner says is nearly spent stops the next attempt until it turns",
	async () => {
		const client = await createServerOwner(backend);
		const resetAt =
			Math.floor(Date.now() / millisecondsPerSecond) + resetInSeconds;
		// Hetzner counts every request a project makes and says what is left on every reply. This
		// is the first one answering that there is almost nothing, which no fake could be asked to
		// do by scripting a refusal: the request itself succeeds.
		const hasAnswered = fake.scriptOnce(
			{ method: "POST", path: createdPrimaryIps },
			{
				status: httpOk,
				body: null,
				headers: {
					"RateLimit-Limit": "3600",
					"RateLimit-Remaining": "1",
					"RateLimit-Reset": String(resetAt),
				},
			},
		);
		const serverId = await createServer(client);

		const deadline = Date.now() + testTimeoutMs / 2;
		let dueAt = 0;
		while (Date.now() < deadline && !hasAnswered()) {
			await Bun.sleep(waitDelayMs);
		}
		while (Date.now() < deadline) {
			dueAt =
				(await readServerBackendRecord(backend, serverId))?.backend?.dueAt ?? 0;
			if (dueAt >= resetAt * millisecondsPerSecond) {
				break;
			}
			await Bun.sleep(waitDelayMs);
		}

		// The allocation waits for the hour to turn rather than learning it by being refused.
		expect(hasAnswered()).toBe(true);
		expect(dueAt).toBeGreaterThanOrEqual(resetAt * millisecondsPerSecond);
	},
	testTimeoutMs,
);
