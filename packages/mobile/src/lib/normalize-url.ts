import { IDE_PATH } from "shared";

// The one place instance-URL rules live. Returns a parsed URL so callers can't
// misuse a raw string. Rejects non-http(s) schemes and embedded credentials;
// preserves pathname/query/hash, since code-server is subpath-sensitive and
// reads ?folder/?workspace (trailing slash matters: /code vs /code/).
const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

// Browsers default a bare address-bar input to https://, and for public hosts
// we do too. But Composery is self-hostable, and LAN boxes are commonly plain
// HTTP (rarely TLS-terminated), so a local-looking host defaults to http:// to
// save users from typing the scheme — the same convention self-host apps like
// Home Assistant use. Whichever wins, an explicit scheme is always honored.
//
// "Local-looking": loopback, RFC1918 private ranges, link-local, `.local`
// (mDNS), and a single-label hostname (no dot — a LAN name like `nas`).
function looksLocalHost(host: string): boolean {
	const h = host.toLowerCase();
	if (h === "localhost") return true;
	if (h.endsWith(".local")) return true;
	if (!h.includes(".")) return true; // single-label LAN hostname

	// WHATWG URL keeps brackets on IPv6 hosts (e.g. "[::1]").
	const bare = h.startsWith("[") && h.endsWith("]") ? h.slice(1, -1) : h;

	const v4 = bare.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (v4) {
		const a = Number(v4[1]);
		const b = Number(v4[2]);
		if (a === 127) return true; // 127/8 loopback
		if (a === 10) return true; // 10/8 private
		if (a === 192 && b === 168) return true; // 192.168/16 private
		if (a === 169 && b === 254) return true; // 169.254/16 link-local
		if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12 private
		return false;
	}

	if (bare === "::1") return true; // IPv6 loopback
	if (bare.startsWith("fe80")) return true; // IPv6 link-local
	return false;
}

export function normalizeInstanceUrl(input: string): URL {
	const trimmed = input.trim();

	// A scheme counts only when followed by `//`, so `host:8080` is a host+port,
	// not a `host:` scheme. A bare host gets a scheme: https:// for public
	// hosts, http:// for local-looking ones (see looksLocalHost).
	let withScheme: string;
	if (SCHEME_RE.test(trimmed)) {
		withScheme = trimmed;
	} else {
		let host = "";
		try {
			host = new URL(`https://${trimmed}`).hostname;
		} catch {
			host = "";
		}
		const scheme = looksLocalHost(host) ? "http://" : "https://";
		withScheme = `${scheme}${trimmed}`;
	}

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

	// Cleartext is useful for a box on the same trusted LAN, but accepting it for
	// a public host would expose the password, session, terminal, and files to the
	// network. Public Composeries have one rule: HTTPS.
	if (url.protocol === "http:" && !looksLocalHost(url.hostname)) {
		throw new Error("Public instances must use HTTPS");
	}

	// The parser keeps leading `//` (`host//code/` -> `//code/`); collapse to one
	// since code-server is subpath-sensitive. Internal `//` is kept.
	if (url.pathname.length > 1 && url.pathname.startsWith("//")) {
		url.pathname = `/${url.pathname.replace(/^\/+/, "")}`;
	}

	// A bare instance address names the product, whose browser surface has one
	// uniform mount. Preserve explicit deeper URLs (folder/workspace links and
	// development fixtures), but make the common host-only input canonical.
	if (url.pathname === "/") url.pathname = IDE_PATH;

	return url;
}
