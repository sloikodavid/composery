import { afterAll } from "bun:test";
import { runCleanups } from "./cleanup";
import { requireHetznerContractKept } from "./hetzner";

// A preload's afterAll runs once, after every test file in the run.
afterAll(async () => {
	try {
		// Whichever test made the requests, the fake must have answered as Hetzner would.
		requireHetznerContractKept();
	} finally {
		await runCleanups();
	}
});
