/**
 * What counts as this machine. Two unrelated rules need it: a bootstrap report may travel over
 * plain HTTP only when it never leaves the machine that sends it, and a setting may name a fake
 * only when the fake answers here. Neither rule owns the fact, so it is stated once.
 */

// Written exactly, because what a name resolves to is not ours to decide.
const loopbackHosts: ReadonlySet<string> = new Set(["127.0.0.1", "[::1]"]);

export function isLoopbackHost(hostname: string) {
	return loopbackHosts.has(hostname);
}
