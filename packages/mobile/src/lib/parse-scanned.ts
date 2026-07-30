import { normalizeInstanceUrl } from "./normalize-url";

// Turns a scanned QR payload into a normalized instance URL, or null if it is not
// one. Accepts a plain instance URL, a bare host, or the app's add-instance deep
// link. Everything else returns null so the scanner can keep looking.
export function parseScannedInstance(value: string): string | null {
	try {
		const candidate =
			value.slice(0, "composery:".length).toLowerCase() === "composery:"
				? parseAddInstanceDeepLink(value)
				: value;
		return normalizeInstanceUrl(candidate).href;
	} catch {
		return null;
	}
}

function parseAddInstanceDeepLink(value: string): string {
	const url = new URL(value);

	if (url.hostname) {
		if (url.hostname !== "add-instance" || !["", "/"].includes(url.pathname)) {
			// Stryker disable next-line StringLiteral: callers intentionally receive
			// null for every rejected scan, so this private diagnostic is unobservable.
			throw new Error("Not an add-instance deep link");
		}
	} else {
		let path = url.pathname;
		while (path.startsWith("/")) path = path.slice(1);
		if (path !== "add-instance") {
			// Stryker disable next-line StringLiteral: callers intentionally receive
			// null for every rejected scan, so this private diagnostic is unobservable.
			throw new Error("Not an add-instance deep link");
		}
	}

	const target = url.searchParams.get("url");
	// Stryker disable next-line ConditionalExpression,StringLiteral: passing the
	// missing null target to normalizeInstanceUrl throws inside the same catch and
	// returns the same public null; the branch exists only to keep the string type.
	if (target === null) throw new Error("Add-instance deep link has no URL");
	return target;
}
