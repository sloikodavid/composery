import { env } from "./_generated/server";

/**
 * Where a test may point Composery instead of an outside system, and why that can only ever be a
 * test. Two conditions must hold together: this deployment answers on this machine alone, and the
 * address is this machine's own. A real deployment satisfies neither, so the same variable set
 * there changes nothing, and no secret leaves the machine that set it.
 */

// Written exactly, because what a name resolves to is not ours to decide.
const loopbackHosts: ReadonlySet<string> = new Set(["127.0.0.1", "[::1]"]);

function isLocalDeployment() {
	try {
		return loopbackHosts.has(new URL(env.CONVEX_SITE_URL).hostname);
	} catch {
		return false;
	}
}

/**
 * The origin of the fake that this variable names, or null when the real system is the one to
 * call. Throws when a local deployment names something that is not this machine, because that is
 * a mistake in a test rather than a reason to reach outside.
 */
export function getFakeAddress(value: string | undefined, name: string) {
	if (!value || !isLocalDeployment()) {
		return null;
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`${name} is not a URL.`);
	}
	if (url.protocol !== "http:" || !loopbackHosts.has(url.hostname)) {
		throw new Error(
			`${name} must be http on 127.0.0.1 or [::1], because only a test sets it.`,
		);
	}
	return url.origin;
}
