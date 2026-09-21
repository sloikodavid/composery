import { afterAll, afterEach } from "bun:test";
import { runCleanups } from "./cleanup";
import { requireContractsKept } from "./contracts";
import { removeHetznerRunResources } from "./hetzner/real";

const cleanupTimeoutMs = 300_000;

// Tests run serially, so cleanup can safely remove the run's provider resources here.
afterEach(async () => {
	await removeHetznerRunResources();
});

// Contract checks run after all requests; cleanup runs even when they fail.
afterAll(
	async () => {
		let contractFailed = false;
		let contractError: unknown;
		try {
			requireContractsKept();
		} catch (error) {
			contractFailed = true;
			contractError = error;
		}
		let cleanupFailed = false;
		let cleanupError: unknown;
		try {
			await runCleanups();
		} catch (error) {
			cleanupFailed = true;
			cleanupError = error;
		}
		if (contractFailed && cleanupFailed) {
			throw new AggregateError(
				[contractError, cleanupError],
				"The contract check and test cleanup both failed.",
			);
		}
		if (contractFailed) {
			throw contractError;
		}
		if (cleanupFailed) {
			throw cleanupError;
		}
	},
	{ timeout: cleanupTimeoutMs },
);
