import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { stubDeploymentEnv, testConvex } from "../../support/convex.ts";

// The two signed webhook routes, asked the only question a test can answer
// without the sender's private key: does an unsigned request get in? Both routes
// act on their body - one records mail delivery, the other deletes a Composery
// account and every box on it - so "verify first" is the whole security of the
// endpoint, and an endpoint that stopped verifying would still answer 2xx to
// every legitimate call and pass any test that only checked the happy path.

beforeEach(() => {
	stubDeploymentEnv();
});

afterEach(() => {
	vi.unstubAllEnvs();
});

// The budget is the file's, not any one test's, because the cost is the file's:
// whichever of these runs first pays for loading the webhook verification stack
// behind both routes (svix, and the Resend component's client), and `shuffle`
// decides which one that is. Measured at ~1s for the first and milliseconds for
// the rest on an idle machine; the whole-repo run contends five packages for the
// same cores, which is where the stock 15s ceiling caught the wrong test.
describe("signed webhook routes", { timeout: 60_000 }, () => {
	// This one throws where the Clerk route below answers 401, and that asymmetry
	// is left alone deliberately. A throw becomes a 500, and Resend retries a 500
	// while it drops a 401 - so an internal failure part-way through recording a
	// delivery event gets another attempt instead of being lost. Reading a clean
	// 401 back out of the component would mean matching on an error name from a
	// transitive dependency, which is a brittle way to buy tidier logs.
	test("the Resend event route refuses an unsigned request", async () => {
		vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test");
		const t = testConvex();

		await expect(
			t.fetch("/resend/events", {
				method: "POST",
				body: JSON.stringify({ type: "email.delivered" })
			})
		).rejects.toThrow(/headers|signature/i);
	});

	test("the Clerk event route refuses an unsigned request", async () => {
		vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "whsec_test");
		const t = testConvex();

		const response = await t.fetch("/clerk/events", {
			method: "POST",
			body: JSON.stringify({ type: "user.deleted", data: { id: "clerk_1" } })
		});

		expect(response.status).toBe(401);
	});

	// A deployment with no Clerk secret must not treat "cannot verify" as
	// "verified": the payload it would then trust deletes an account.
	test("the Clerk event route refuses everything when it has no secret", async () => {
		const t = testConvex();

		const response = await t.fetch("/clerk/events", {
			method: "POST",
			body: JSON.stringify({ type: "user.deleted", data: { id: "clerk_1" } })
		});

		expect(response.status).toBe(500);
	});
});
