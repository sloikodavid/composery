export type WebViewNavigationTarget = "external" | "inside" | "reject";

// A verified Composery owns only its origin and configured mount path. Top-level
// navigation anywhere else must leave the main WebView: external pages never get
// its JavaScript bridge or injected IDE helpers. The cloud authorization is
// recognized separately below and opens in an isolated WebView that shares only
// the platform cookie store needed to return its PKCE transaction to the box.
// Subframes stay under the normal same-origin/CSP rules and cannot replace the
// main document.
export function classifyWebViewNavigation({
	instanceUrl,
	isTopFrame,
	requestUrl
}: {
	instanceUrl: string;
	isTopFrame: boolean | undefined;
	requestUrl: string;
}): WebViewNavigationTarget {
	if (isTopFrame === false) return "inside";

	let instance: URL;
	let request: URL;
	try {
		instance = new URL(instanceUrl);
		request = new URL(requestUrl);
	} catch {
		return "reject";
	}

	if (["mailto:", "tel:"].includes(request.protocol)) return "external";
	if (!["http:", "https:"].includes(request.protocol)) return "reject";
	if (request.origin !== instance.origin) return "external";

	const mount = instance.pathname.replace(/\/+$/, "") || "/";
	if (mount === "/") return "inside";
	if (request.pathname === mount || request.pathname.startsWith(`${mount}/`)) {
		return "inside";
	}

	return "external";
}

function instanceMount(instance: URL): string {
	return instance.pathname.replace(/\/+$/, "") || "/";
}

function cloudCallbackPath(instance: URL): string {
	const mount = instanceMount(instance);
	return `${mount === "/" ? "" : mount}/_composery/cloud/callback`;
}

// The URL came from the box, but this check keeps a self-hosted or compromised
// instance from turning an arbitrary external page into the privileged-looking
// authentication window. A real request names this exact instance's callback;
// the callback's PKCE verifier remains in the shared box cookie store.
export function isCloudAuthorizationRequest({
	instanceUrl,
	requestUrl
}: {
	instanceUrl: string;
	requestUrl: string;
}): boolean {
	try {
		const instance = new URL(instanceUrl);
		const request = new URL(requestUrl);
		const callback = new URL(request.searchParams.get("redirect_uri") ?? "");
		return (
			request.protocol === "https:" &&
			request.pathname === "/boxes/authorize" &&
			callback.origin === instance.origin &&
			callback.pathname === cloudCallbackPath(instance) &&
			!callback.username &&
			!callback.password &&
			!callback.search &&
			!callback.hash
		);
	} catch {
		return false;
	}
}

// Once the isolated authentication view returns through the callback and lands
// anywhere else inside the verified mount, the shared cookie has been installed.
// The main IDE WebView can reload into that same authenticated state. Keep the
// callback and error page in the auth view so failures remain visible.
export function isCloudAuthorizationSuccess({
	instanceUrl,
	requestUrl
}: {
	instanceUrl: string;
	requestUrl: string;
}): boolean {
	try {
		const instance = new URL(instanceUrl);
		const request = new URL(requestUrl);
		const mount = instanceMount(instance);
		const inside =
			request.origin === instance.origin &&
			(mount === "/" ||
				request.pathname === mount ||
				request.pathname.startsWith(`${mount}/`));
		return (
			inside &&
			request.pathname !== cloudCallbackPath(instance) &&
			!request.pathname.endsWith("/_composery/cloud/error")
		);
	} catch {
		return false;
	}
}
