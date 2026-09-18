import { afterAll } from "bun:test";
import { runCleanups } from "./cleanup";
import { requireContractsKept } from "./contracts";

// A preload's afterAll runs once, after every test file in the run.
afterAll(async () => {
	try {
		// Whichever test made the requests, a fake must have answered as that system would.
		requireContractsKept();
	} finally {
		await runCleanups();
	}
});
