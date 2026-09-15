type Cleanup = () => void | Promise<void>;

const cleanups: Cleanup[] = [];

/**
 * Stops a resource when the run ends. `bun test` emits no exit event, so the preload drains this
 * list after the last test file; a run that is killed leaves the resource for the next run to sweep.
 */
export function registerCleanup(cleanup: Cleanup) {
	cleanups.push(cleanup);
}

/** Runs every cleanup, newest first, and reports all failures together instead of stopping at one. */
export async function runCleanups() {
	const failures: unknown[] = [];
	for (const cleanup of cleanups.splice(0).reverse()) {
		try {
			await cleanup();
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length > 0) {
		throw new AggregateError(failures, "Some test resources were not stopped.");
	}
}
