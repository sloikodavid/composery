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
const millisecondsPerSecond = 1000;
const hourlyLimit = 3600;
// Hetzner gives one request back each second, so a few seconds bring back what the deployment
// waits for. The next attempt of an allocation that is not waiting on anything comes within
// seconds as well, so the bound is well past that and still an hour short of the reset.
const leastPauseMs = 15_000;
const mostPauseMs = 120_000;
const createdPrimaryIps = /^\/primary_ips$/;

let backend: ConvexBackend;
let fake: HetznerFake;

beforeAll(async () => {
	backend = await useConvexBackend();
	fake = await useHetznerFake();
}, setupTimeoutMs);

test(
	"an hour Hetzner says is nearly spent holds the next attempt until enough of it is back",
	async () => {
		const client = await createServerOwner(backend);
		const resetAt =
			Math.floor(Date.now() / millisecondsPerSecond) + hourlyLimit - 1;
		// Every reply says what is left of the project's hour. This one is an ordinary answer that
		// says almost nothing is, which no scripted refusal could say: the request itself succeeds.
		const hasAnswered = fake.scriptOnce(
			{ method: "POST", path: createdPrimaryIps },
			{
				headers: {
					"RateLimit-Limit": String(hourlyLimit),
					"RateLimit-Remaining": "1",
					"RateLimit-Reset": String(resetAt),
				},
			},
		);
		const serverId = await createServer(client);

		const deadline = Date.now() + testTimeoutMs / 2;
		while (Date.now() < deadline && !hasAnswered()) {
			await Bun.sleep(waitDelayMs);
		}
		const answeredAt = Date.now();
		// While the run holds its lease, the next attempt is the lease's own end. What the run
		// recorded is there once the lease is given back.
		let dueAt = 0;
		while (Date.now() < deadline) {
			const record = (await readServerBackendRecord(backend, serverId))
				?.backend;
			if (
				record !== undefined &&
				record !== null &&
				record.leaseExpiresAt === 0
			) {
				dueAt = record.dueAt;
				break;
			}
			await Bun.sleep(waitDelayMs);
		}

		// The allocation waits for what it needs to come back, and not for the whole hour.
		expect(hasAnswered()).toBe(true);
		expect(dueAt).toBeGreaterThanOrEqual(answeredAt + leastPauseMs);
		expect(dueAt).toBeLessThan(answeredAt + mostPauseMs);
	},
	testTimeoutMs,
);
