import { env } from "./_generated/server";
import { isLoopbackHost } from "./loopback";

function isLocalDeployment() {
	try {
		return isLoopbackHost(new URL(env.CONVEX_SITE_URL).hostname);
	} catch {
		return false;
	}
}

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
	if (url.protocol !== "http:" || !isLoopbackHost(url.hostname)) {
		throw new Error(
			`${name} must be http on 127.0.0.1 or [::1], because only a test sets it.`,
		);
	}
	return url.origin;
}
