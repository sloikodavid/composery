import { afterAll, afterEach } from "bun:test";
import { runCleanups } from "./cleanup";
import { requireContractsKept } from "./contracts";
import { removeHetznerRunResources } from "./hetzner/real";

// Tests run serially, so cleanup can safely remove the run's provider resources here.
afterEach(async () => {
	await removeHetznerRunResources();
});

// Contract checks run after all requests; cleanup runs even when they fail.
afterAll(async () => {
	try {
		requireContractsKept();
	} finally {
		await runCleanups();
	}
});
