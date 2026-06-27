/**
 * Validate and normalize a Composery instance URL.
 *
 * The only place URL rules live. Pure: no React Native imports, so it runs in
 * Vitest in plain Node. Callers receive a standard `URL` and cannot misuse a
 * raw string. Self-hosted (any domain/port/subpath) and Cloud flow through
 * identically.
 *
 * - Rejects non-http(s) schemes (file:, custom deep-link schemes, etc.).
 * - If no scheme is present but a host is, prepends `https://`.
 * - Lowercases the host (the URL parser does this); leaves path/query/hash case.
 * - Preserves pathname (subpath-hosted instances), search (?folder=/?workspace=),
 *   and hash — code-server reads these and supports reverse-proxy subpaths.
 * - Collapses repeated leading slashes in the pathname to one; keeps trailing
 *   slashes (/code vs /code/ matters).
 * - Rejects URLs containing credentials (user:pass@).
 */
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export function normalizeInstanceUrl(input: string): URL {
	const trimmed = input.trim();

	// Prepend a default scheme when the user typed a bare host (`mybox.com`).
	// A scheme is only recognized when followed by `//`, so a bare `host:8080`
	// (no `//`) is treated as a host+port and `ftp://x` keeps its scheme.
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

	// Collapse repeated leading slashes in the pathname to one. The URL parser
	// preserves them (`https://host//code/` -> pathname `//code/`); code-server
	// is subpath-sensitive, so normalize to `/code/`. Internal `//` is kept.
	if (url.pathname.length > 1 && url.pathname.startsWith("//")) {
		url.pathname = `/${url.pathname.replace(/^\/+/, "")}`;
	}

	return url;
}
