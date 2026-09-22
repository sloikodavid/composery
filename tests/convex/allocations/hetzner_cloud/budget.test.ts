import { afterAll, beforeAll, expect, test } from "bun:test";
import { getHetznerCloudResumeAt } from "../../../../convex/allocations/hetzner_cloud/pacing";
import {
	type ConvexBackend,
	startConvexBackend,
} from "../../../../harness/convex/backend";
import type { HetznerFake } from "../../../../harness/hetzner/fake";
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
// The fake refills one request per second; the bound covers pacing, not a full reset.
const leastPauseMs = 15_000;
const mostPauseMs = 120_000;
const createdPrimaryIps = /^\/primary_ips$/;
const budgetObservedAt = 1000;
const budgetResetAt = 2000;
const budgetBeforeReset = 1500;
const budgetAfterReset = 2001;
const budgetResumeAt = 1110;

let backend: ConvexBackend;
let fake: HetznerFake;

test("pacing returns finite, bounded resume times for budget edges", () => {
	const exhausted = {
		limit: 100,
		remaining: 0,
		resetAt: budgetResetAt,
		observedAt: budgetObservedAt,
	};
	expect(getHetznerCloudResumeAt(exhausted, budgetObservedAt)).toBe(
		budgetResumeAt,
	);
	expect(getHetznerCloudResumeAt(exhausted, budgetAfterReset)).toBe(
		budgetAfterReset,
	);
	expect(
		getHetznerCloudResumeAt(
			{ ...exhausted, remaining: 100 },
			budgetBeforeReset,
		),
	).toBe(budgetBeforeReset);
	expect(
		getHetznerCloudResumeAt({ ...exhausted, remaining: -1 }, budgetBeforeReset),
	).toBe(budgetBeforeReset);
	expect(
		getHetznerCloudResumeAt({ ...exhausted, limit: 0 }, budgetBeforeReset),
	).toBe(budgetBeforeReset);
	expect(
		getHetznerCloudResumeAt(
			{ ...exhausted, observedAt: budgetResetAt + 1 },
			budgetBeforeReset,
		),
	).toBe(budgetBeforeReset);
});

const resources = new AsyncDisposableStack();

beforeAll(async () => {
	backend = await startConvexBackend();
	resources.defer(backend.stop);
	fake = backend.hetzner;
}, setupTimeoutMs);

test(
	"an hour Hetzner says is nearly spent holds the next attempt until enough of it is back",
	async () => {
		const client = await createServerOwner(backend);
		const resetAt =
			Math.floor(Date.now() / millisecondsPerSecond) + hourlyLimit - 1;
		// A successful response can still leave only one request in the budget.
		const hasAnswered = fake.scriptOnce(
			{ method: "POST", path: createdPrimaryIps },
			{
				kind: "extraHeaders",
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

		expect(hasAnswered()).toBe(true);
		expect(dueAt).toBeGreaterThanOrEqual(answeredAt + leastPauseMs);
		expect(dueAt).toBeLessThan(answeredAt + mostPauseMs);
	},
	testTimeoutMs,
);

afterAll(() => resources.disposeAsync(), setupTimeoutMs);
