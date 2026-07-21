export type WebViewNavigationTarget = "external" | "inside" | "reject";

// A verified Composery owns only its origin and configured mount path. Top-level
// navigation anywhere else must leave the app: external pages never get the
// WebView's cookies, JavaScript bridge, or injected IDE helpers. Subframes stay
// under the WebView's normal same-origin/CSP rules and cannot replace the main
// document.
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
