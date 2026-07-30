import { IDE_PATH } from "shared";

// The one place instance-URL rules live. Returns a parsed URL so callers can't
// misuse a raw string. Rejects non-http(s) schemes and embedded credentials;
// preserves pathname/query/hash, since code-server is subpath-sensitive and
// reads ?folder/?workspace (trailing slash matters: /code vs /code/).
// Stryker disable next-line Regex: removing the anchor only admits leading junk,
// which the final WHATWG URL parse rejects before any result can escape.
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
	if (h.endsWith(".local")) return true;

	// WHATWG URL keeps brackets on IPv6 hosts (e.g. "[::1]").
	const bare = h.startsWith("[") ? h.slice(1, -1) : h;
	if (!bare.includes(".") && !bare.includes(":")) return true;

	const v4 = bare.split(".");
	// WHATWG canonicalizes every valid IPv4 spelling to four numeric segments
	// and rejects non-four-part numeric hosts before this function runs.
	if (v4.every((part) => String(Number(part)) === part)) {
		const a = Number(v4[0]);
		const b = Number(v4[1]);
		return (
			a === 127 || // 127/8 loopback
			a === 10 || // 10/8 private
			(a === 192 && b === 168) || // 192.168/16 private
			(a === 169 && b === 254) || // 169.254/16 link-local
			(a === 172 && b >= 16 && b <= 31) // 172.16/12 private
		);
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
	let url: URL;
	try {
		const withScheme = SCHEME_RE.test(trimmed)
			? trimmed
			: `${looksLocalHost(new URL(`https://${trimmed}`).hostname) ? "http://" : "https://"}${trimmed}`;
		url = new URL(withScheme);
	} catch {
		throw new Error(`Invalid URL: ${input}`);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Unsupported scheme: ${url.protocol}`);
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
	while (url.pathname.startsWith("//")) url.pathname = url.pathname.slice(1);

	// A bare instance address names the product, whose browser surface has one
	// uniform mount. Preserve explicit deeper URLs (folder/workspace links and
	// development fixtures), but make the common host-only input canonical.
	if (url.pathname === "/") url.pathname = IDE_PATH;

	return url;
}
