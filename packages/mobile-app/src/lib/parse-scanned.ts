import { normalizeInstanceUrl } from "./normalize-url";

// Turns a scanned QR payload into a normalized instance URL, or null if it is not
// one. Accepts a plain instance URL, a bare host, or the app's add-instance deep
// link. Everything else returns null so the scanner can keep looking.
export function parseScannedInstance(value: string): string | null {
	let candidate = value.trim();
	if (!candidate) return null;

	if (/^composery:/i.test(candidate)) {
		const url = parseAddInstanceDeepLink(candidate);
		if (!url) return null;
		candidate = url;
	}

	try {
		return normalizeInstanceUrl(candidate).href;
	} catch {
		return null;
	}
}

function parseAddInstanceDeepLink(value: string): string | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}

	if (url.protocol !== "composery:") return null;

	if (url.hostname) {
		if (url.hostname !== "add-instance" || !["", "/"].includes(url.pathname)) {
			return null;
		}
	} else if (url.pathname.replace(/^\/+/, "") !== "add-instance") {
		return null;
	}

	return url.searchParams.get("url");
}
