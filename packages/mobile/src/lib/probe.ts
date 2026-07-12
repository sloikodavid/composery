// Probes a URL to verify it's a Composery before loading it in the WebView.
// The server exposes GET /__composery → {"composery":true} for this. A
// non-Composery site (or one that's unreachable) is rejected before the
// WebView tries to embed it — avoiding the blank-screen failure mode.
export type ProbeResult =
	| { ok: true }
	| { ok: false; reason: "not-composery" }
	| { ok: false; reason: "unreachable"; message: string };

export type ProbeFetch = typeof fetch;

// Builds an endpoint URL relative to the instance URL's pathname, so a
// subpath-mounted Composery (e.g. https://host/my-cs/) probes
// /my-cs/__composery, not /__composery. Strips query/hash.
function endpointUrl(instanceUrl: string, endpoint: string): string {
	const url = new URL(instanceUrl);
	const path = url.pathname.replace(/\/+$/, "");
	url.pathname = path + endpoint;
	url.search = "";
	url.hash = "";
	return url.href;
}

export function probeUrl(instanceUrl: string): string {
	return endpointUrl(instanceUrl, "/__composery");
}

export function versionUrl(instanceUrl: string): string {
	return endpointUrl(instanceUrl, "/version");
}

export async function probeComposery(
	instanceUrl: string,
	options: { timeoutMs?: number; fetchImpl?: ProbeFetch } = {}
): Promise<ProbeResult> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 5000;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchImpl(probeUrl(instanceUrl), {
			signal: controller.signal,
			redirect: "follow",
			headers: { accept: "application/json" }
		});
		if (!response.ok) return { ok: false, reason: "not-composery" };
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			return { ok: false, reason: "not-composery" };
		}
		if (
			typeof body === "object" &&
			body !== null &&
			(body as Record<string, unknown>).composery === true
		) {
			return { ok: true };
		}
		return { ok: false, reason: "not-composery" };
	} catch {
		return {
			ok: false,
			reason: "unreachable",
			message: "Couldn't reach the server"
		};
	} finally {
		clearTimeout(timer);
	}
}

// Fetches the server's build stamp from GET /version (authenticated through
// the WebView's shared session cookie). A stamp change between two fetches
// means the instance was updated while the WebView kept the old session
// alive — the caller reloads it. Null (signed out, unreachable, or a
// non-stamp response) skips the check.
export async function fetchServerStamp(
	instanceUrl: string,
	options: { timeoutMs?: number; fetchImpl?: ProbeFetch } = {}
): Promise<string | null> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 5000;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const response = await fetchImpl(versionUrl(instanceUrl), {
			signal: controller.signal,
			credentials: "include",
			headers: { accept: "text/plain" }
		});
		if (!response.ok) return null;
		const text = (await response.text()).trim();
		return /^[0-9a-f]{7,64}$/i.test(text) ? text : null;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}
