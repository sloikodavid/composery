// Used for both local fake endpoints and plaintext bootstrap reports.
const loopbackHosts: ReadonlySet<string> = new Set(["127.0.0.1", "[::1]"]);

export function isLoopbackHost(hostname: string) {
	return loopbackHosts.has(hostname);
}
