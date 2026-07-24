// Scripts injected into the instance WebView, kept here (not inline) so the
// placement logic is unit-tested and the selectors can't drift from the IDE.
// The back control IS the title-bar logo (`.window-appicon`): the existing
// anchor is rewired to post back instead of navigating, so size, icon,
// mono-mask theming and hover all come from the IDE's own CSS. No fallback: if
// the logo is absent (login/error HTML have no title bar), no control is
// injected.

export const TITLEBAR_LEFT_SELECTOR = ".part.titlebar .titlebar-left";
export const WORKBENCH_SELECTOR = ".monaco-workbench";
export const APPICON_SELECTOR = ".window-appicon";

export type Placement = "titlebar" | "wait";

// Whether an element's computed background is the colour that is actually on
// screen, and so safe to report as the status-bar strip. Kept as source rather
// than a TS function because the script is injected as a string and Hermes does
// not preserve Function#toString - this is the only way the script and its test
// can share one copy of the rule.
export const USABLE_BG_SOURCE = `function usableBg(bg) {
	// Only rgb()/rgba(). "transparent", "" and the colour syntaxes React Native
	// cannot parse (color(), oklch()) are not usable surface colours.
	if (!bg || bg.indexOf("rgb") !== 0) return null;
	// A translucent surface composites over whatever is behind it, so its
	// computed colour is not the colour on screen. A theme that sets the title
	// bar with 8-digit hex - #ffffff10 over a black workbench - paints a
	// near-black strip but reads as light, which flips the status-bar icons to
	// black-on-black. Take the opaque surface underneath instead: that is what
	// the eye sees through it anyway.
	var parts = bg.match(/-?\\d*\\.?\\d+/g) || [];
	return parts.length > 3 && Number(parts[3]) < 1 ? null : bg;
}`;

// Rewire once the title-bar logo exists; until then wait (the workbench builds
// it async, and the poll retries). No floating fallback.
export function choosePlacement(state: { hasAppicon: boolean }): Placement {
	return state.hasAppicon ? "titlebar" : "wait";
}

// Runs before the page's scripts: flag native mode and make prefers-color-scheme
// follow the app, so code-server "detect" theming works on iOS and the flaky
// Android WebView. VS Code's BrowserHostColorSchemeService reads the query and
// listens for 'change', so the synthetic media query stores listeners and
// exposes __composerySetScheme to fire them on a live theme flip (no reload).
// Non-color queries pass through, so the narrow/touch gates are untouched.
export function buildBeforeLoad(scheme: "light" | "dark", dev = false): string {
	return `
window.__composeryNative = true;
window.__composeryDev = ${dev};
window.__composeryScheme = ${JSON.stringify(scheme)};
(function () {
	if (!window.matchMedia || window.__composeryMatchMediaPatched) return;
	window.__composeryMatchMediaPatched = true;
	var real = window.matchMedia.bind(window);
	// The WebView's own scheme, kept for diagnostics - it diverges from the
	// app scheme on Android, which is why the shim and data-scheme exist.
	window.__composeryNativeDark = real("(prefers-color-scheme: dark)").matches;
	var queries = [];
	// CSS media queries can't be shimmed like matchMedia, and the WebView's
	// native prefers-color-scheme tracks the Android activity theme, not the
	// system. Pages key their scheme CSS on data-scheme as the app override
	// (auth pages via brand.css, workbench first-paint via web-client.diff).
	function stampScheme() {
		if (document.documentElement) {
			document.documentElement.dataset.scheme = window.__composeryScheme;
		}
	}
	stampScheme();
	document.addEventListener("DOMContentLoaded", stampScheme);
	window.matchMedia = function (query) {
		var match = /^\\s*\\(\\s*prefers-color-scheme\\s*:\\s*(dark|light)\\s*\\)\\s*$/i.exec(query);
		// Only synthesize the exact queries the IDE consumes. A compound query has
		// browser semantics beyond this shim; passing it through is predictable,
		// while treating every query containing these words as only dark-or-light
		// silently discards the rest of its conditions.
		if (!match) return real(query);
		var wanted = match[1].toLowerCase();
		var listeners = [];
		var entry = { wanted: wanted, listeners: listeners, last: wanted === window.__composeryScheme, mql: null };
		var mql = {
			media: query, onchange: null,
			get matches() { return wanted === window.__composeryScheme; },
			addEventListener: function (type, cb) { if (type === "change" && cb && listeners.indexOf(cb) < 0) listeners.push(cb); },
			removeEventListener: function (type, cb) { listeners = listeners.filter(function (l) { return l !== cb; }); },
			addListener: function (cb) { if (cb && listeners.indexOf(cb) < 0) listeners.push(cb); },
			removeListener: function (cb) { listeners = listeners.filter(function (l) { return l !== cb; }); },
			dispatchEvent: function (ev) {
				if (typeof mql.onchange === "function") mql.onchange.call(mql, ev);
				listeners.slice().forEach(function (cb) { cb.call(mql, ev); });
				return true;
			}
		};
		entry.mql = mql;
		queries.push(entry);
		return mql;
	};
	window.__composerySetScheme = function (s) {
		window.__composeryScheme = s === "dark" ? "dark" : "light";
		stampScheme();
		queries.slice().forEach(function (entry) {
			var next = entry.wanted === window.__composeryScheme;
			if (next === entry.last) return;
			entry.last = next;
			var ev = { matches: next, media: entry.mql.media };
			try { entry.mql.dispatchEvent(ev); } catch (e) {}
		});
	};
})();
true;`;
}

// Injected on every hardware/gesture back press. The page owns the decision: it
// closes its topmost layer, or posts "composery:back" when it has none and the
// app should leave for the instance list. The WebView's own session history is
// never walked - inside the IDE it holds login redirects and workbench sentinels,
// none of which is a place the user asked to go back to.
export const NATIVE_BACK_SCRIPT = `window.__composeryNativeBack && window.__composeryNativeBack(); true;`;

// Runs after load: rewires the title-bar logo as the back control and reports
// the live title-bar background so the app can tint the status-bar strip to
// match any IDE theme.
export const INSTALL_SCRIPT = `(function () {
	var ID = "composery-native-back";
	var TITLEBAR = ${JSON.stringify(TITLEBAR_LEFT_SELECTOR)};
	var WORKBENCH = ${JSON.stringify(WORKBENCH_SELECTOR)};
	var APPICON = ${JSON.stringify(APPICON_SELECTOR)};
	var lastBg = "";

	function post(m) { try { window.ReactNativeWebView.postMessage(m); } catch (e) {} }

	// Hardware/gesture back asks the page to close its topmost layer. The workbench
	// defines this itself (shell.js) and knows its menus, dialogs and full-screen
	// parts; the login and error pages have no layers, so back there means leave.
	// Never overwrite the workbench's - it loads first, this runs at load end.
	if (!window.__composeryNativeBack) {
		window.__composeryNativeBack = function () { post("composery:back"); return false; };
	}

	function ensureStyle() {
		if (document.getElementById(ID + "-style")) return;
		var s = document.createElement("style");
		s.id = ID + "-style";
		// The control is the IDE's own .window-appicon, so its look and layout
		// come from the IDE's CSS. Only app deltas live here: tap-highlight/
		// callout resets for the WebView, active/focus feedback, and no sticky
		// hover wash after a tap.
		s.textContent =
			"#" + ID + "{cursor:pointer;outline:none;" +
			"-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;}" +
			"#" + ID + ":active{opacity:0.8;}" +
			"@media (hover: none){#" + ID + ":hover{opacity:1;}}" +
			"#" + ID + ":focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px;}";
		(document.head || document.documentElement).appendChild(s);
	}

	function placeTitlebar() {
		var left = document.querySelector(TITLEBAR);
		if (!left || document.getElementById(ID)) return;
		var logo = left.querySelector(APPICON);
		if (!logo) return;
		ensureStyle();
		logo.id = ID;
		// No href: the logo must post back, not navigate the WebView to the
		// website, and without it the titlebar-logo patch skips its link context
		// menu (long-press falls through to the normal titlebar menu).
		logo.removeAttribute("href");
		logo.setAttribute("role", "button");
		logo.setAttribute("tabindex", "0");
		logo.setAttribute("aria-label", "Back to instances");
		logo.setAttribute("title", "Back to instances");
		function go(e) { e.preventDefault(); e.stopPropagation(); post("composery:back"); }
		logo.addEventListener("click", go);
		// An anchor without href has no native activation; cover hardware keyboards.
		logo.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") go(e); });
	}

	${USABLE_BG_SOURCE}

	function surfaceBg(el) {
		return el ? usableBg(getComputedStyle(el).backgroundColor) : null;
	}

	function readBg() {
		// On the workbench the title bar is the top surface; on any other page
		// (login, error pages) use the page's own background. Keeps the strip
		// matching the page, not a stale theme colour. Nothing opaque anywhere
		// reports empty, and the app falls back to its own background - never a
		// guessed white, which would be a white bar over a dark app.
		var color =
			surfaceBg(document.querySelector(".part.titlebar")) ||
			surfaceBg(document.querySelector(WORKBENCH)) ||
			surfaceBg(document.body) ||
			surfaceBg(document.documentElement) ||
			"";
		if (color !== lastBg) {
			lastBg = color;
			post("composery:bg:" + color);
		}
	}

	// One-shot layout facts for the Metro console - the WebView can't be
	// eyeballed like a browser tab, and it has behaved differently before
	// (native scheme, menubar overflow), so keep the evidence one repro away.
	function diag() {
		try {
			var mb = document.querySelector(".menubar");
			var btns = mb ? [].slice.call(mb.querySelectorAll(".menubar-menu-button")) : [];
			post("composery:diag:" + JSON.stringify({
				ua: navigator.userAgent,
				w: window.innerWidth,
				dpr: window.devicePixelRatio,
				nativeDark: !!window.__composeryNativeDark,
				scheme: window.__composeryScheme || null,
				menubarW: mb ? mb.offsetWidth : null,
				menubarFlex: mb ? getComputedStyle(mb).flex : null,
				visibleMenus: btns.filter(function (b) { return b.style.visibility !== "hidden"; }).length,
				totalMenus: btns.length
			}));
		} catch (e) {}
	}

	// Dev only: production would compute and post a message nobody logs.
	if (window.__composeryDev) {
		diag();
		setTimeout(diag, 6000);
	}
	// Poll, never observe: a document-wide MutationObserver (attributes + childList
	// + subtree) makes the browser allocate a record for every DOM change, and
	// Monaco and the terminal make thousands a second - overhead the same page
	// never carries in Chrome, where none of this script runs. The rAF it
	// scheduled also forced a style recalc per frame via getComputedStyle. Two
	// cheap reads twice a second cover the same needs (logo rebuilt, theme
	// flipped) at no per-mutation cost.
	placeTitlebar();
	readBg();
	setInterval(function () { placeTitlebar(); readBg(); }, 500);
})();
true;`;
