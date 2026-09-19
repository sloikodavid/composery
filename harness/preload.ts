import { afterAll, afterEach } from "bun:test";
import { runCleanups } from "./cleanup";
import { requireContractsKept } from "./contracts";
import { removeHetznerRunResources } from "./hetzner/real";

// Each test makes its own server, so a run holds as many at once as it has tests that make one,
// and a project allows a fixed number. What a finished test made is nobody's any more, so it goes
// as soon as the test ends and a run holds one or two at a time however many tests there are.
//
// This removes everything this run made, which is safe because tests run one after another: no
// other test's server is alive when this runs. A test that ran beside another would need its own
// resources named instead.
afterEach(async () => {
	await removeHetznerRunResources();
});

// A preload's afterAll runs once, after every test file in the run.
afterAll(async () => {
	try {
		// Whichever test made the requests, a fake must have answered as that system would.
		requireContractsKept();
	} finally {
		await runCleanups();
	}
});
