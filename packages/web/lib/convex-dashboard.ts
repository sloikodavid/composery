const DEPLOYMENT = (() => {
	const url = process.env.NEXT_PUBLIC_CONVEX_URL;
	if (!url) return null;
	try {
		return new URL(url).hostname.split(".")[0];
	} catch {
		return null;
	}
})();

// The dashboard decodes `filters` as base64url(JSON.stringify(FilterExpression))
// where each clause is { op, field, value, enabled, id }. See get-convex/convex-
// backend system-udfs filters.ts; changing this shape silently breaks the link.
function base64Url(input: string) {
	const bytes = new TextEncoder().encode(input);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

export function convexTableUrl(table: string) {
	if (!DEPLOYMENT) return null;
	return `https://dashboard.convex.dev/d/${DEPLOYMENT}/data?table=${table}`;
}

export function convexFilterUrl(table: string, value: string, field = "_id") {
	const base = convexTableUrl(table);
	if (!base) return null;
	const expression = {
		clauses: [{ op: "eq", field, value, enabled: true, id: field }]
	};
	return `${base}&filters=${base64Url(JSON.stringify(expression))}`;
}
