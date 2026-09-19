type Cleanup = () => void | Promise<void>;

export function isProcessAlive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists but belongs to another user.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

const cleanups: Cleanup[] = [];

/** Runs newest-first and reports all cleanup failures together. */
export function registerCleanup(cleanup: Cleanup) {
	cleanups.push(cleanup);
}

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
