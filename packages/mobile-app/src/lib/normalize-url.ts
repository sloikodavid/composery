// The one place instance-URL rules live. Returns a parsed URL so callers can't
// misuse a raw string. Rejects non-http(s) schemes and embedded credentials;
// preserves pathname/query/hash, since code-server is subpath-sensitive and
// reads ?folder/?workspace (trailing slash matters: /code vs /code/).
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export function normalizeInstanceUrl(input: string): URL {
	const trimmed = input.trim();

	// Bare host (`mybox.com`) gets https://. A scheme counts only when followed
	// by `//`, so `host:8080` is a host+port, not a `host:` scheme.
	const withScheme = SCHEME_RE.test(trimmed) ? trimmed : `https://${trimmed}`;

	let url: URL;
	try {
		url = new URL(withScheme);
	} catch {
		throw new Error(`Invalid URL: ${input}`);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Unsupported scheme: ${url.protocol}`);
	}

	if (!url.hostname) {
		throw new Error(`URL has no host: ${input}`);
	}

	if (url.username || url.password) {
		throw new Error(`URL must not contain credentials: ${input}`);
	}

	// The parser keeps leading `//` (`host//code/` -> `//code/`); collapse to one
	// since code-server is subpath-sensitive. Internal `//` is kept.
	if (url.pathname.length > 1 && url.pathname.startsWith("//")) {
		url.pathname = `/${url.pathname.replace(/^\/+/, "")}`;
	}

	return url;
}
