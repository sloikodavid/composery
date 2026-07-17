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

// Rewire once the title-bar logo exists; until then wait (the workbench builds
// it async, and the observer retries). No floating fallback.
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
	var listeners = [];
	// CSS media queries can't be shimmed like matchMedia, and the WebView's
	// native prefers-color-scheme tracks the Android activity theme, not the
	// system. Pages key their scheme CSS on data-scheme as the app override
	// (auth pages via brand.css, workbench first-paint via overlays.diff).
	function stampScheme() {
		if (document.documentElement) {
			document.documentElement.dataset.scheme = window.__composeryScheme;
		}
	}
	stampScheme();
	document.addEventListener("DOMContentLoaded", stampScheme);
	window.matchMedia = function (query) {
		if (!/prefers-color-scheme/i.test(query)) return real(query);
		return {
			media: query, onchange: null,
			get matches() { return /dark/i.test(query) === (window.__composeryScheme === "dark"); },
			addEventListener: function (type, cb) { if (type === "change" && cb) listeners.push(cb); },
			removeEventListener: function (type, cb) { listeners = listeners.filter(function (l) { return l !== cb; }); },
			addListener: function (cb) { if (cb) listeners.push(cb); },
			removeListener: function (cb) { listeners = listeners.filter(function (l) { return l !== cb; }); },
			dispatchEvent: function () { return false; }
		};
	};
	window.__composerySetScheme = function (s) {
		window.__composeryScheme = s === "dark" ? "dark" : "light";
		stampScheme();
		var ev = { matches: window.__composeryScheme === "dark", media: "(prefers-color-scheme: dark)" };
		listeners.slice().forEach(function (cb) { try { cb.call(null, ev); } catch (e) {} });
	};
})();
true;`;
}

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

	function isTransparent(c) {
		return !c || c === "transparent" || c === "rgba(0, 0, 0, 0)";
	}

	function surfaceBg(el) {
		if (!el) return null;
		var bg = getComputedStyle(el).backgroundColor;
		return isTransparent(bg) ? null : bg;
	}

	function readBg() {
		// On the workbench the title bar is the top surface; on any other page
		// (login, error pages) use the page's own background, defaulting to white.
		// Keeps the strip matching the page, not a stale theme colour.
		var color =
			surfaceBg(document.querySelector(".part.titlebar")) ||
			surfaceBg(document.querySelector(WORKBENCH)) ||
			surfaceBg(document.body) ||
			surfaceBg(document.documentElement) ||
			"rgb(255, 255, 255)";
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

	var scheduled = false;
	function schedule() {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(function () { scheduled = false; placeTitlebar(); readBg(); });
	}

	// Dev only: production would compute and post a message nobody logs.
	if (window.__composeryDev) {
		diag();
		setTimeout(diag, 6000);
	}
	schedule();
	new MutationObserver(schedule).observe(document.documentElement, {
		attributes: true, childList: true, subtree: true
	});
})();
true;`;
