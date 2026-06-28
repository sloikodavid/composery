// Scripts injected into the instance WebView, kept here (not inline) so the
// placement logic is unit-tested and the selectors can't drift from the IDE.
// `.titlebar-left` is stock VS Code (created unconditionally), so the back
// control works on any version without the titlebar-logo patch. No fallback: if
// the title bar is absent (login/error HTML), no button is injected.

export const TITLEBAR_LEFT_SELECTOR = ".part.titlebar .titlebar-left";
export const WORKBENCH_SELECTOR = ".monaco-workbench";
export const APPICON_SELECTOR = ".window-appicon";

export type Placement = "titlebar" | "wait";

// Place once the title bar's left slot exists; until then wait (the workbench
// builds it async, and the observer retries). No floating fallback.
export function choosePlacement(state: {
	hasTitlebarLeft: boolean;
}): Placement {
	return state.hasTitlebarLeft ? "titlebar" : "wait";
}

// Runs before the page's scripts: flag native mode and make prefers-color-scheme
// follow the app, so code-server "detect" theming works on iOS and the flaky
// Android WebView. VS Code's BrowserHostColorSchemeService reads the query and
// listens for 'change', so the synthetic media query stores listeners and
// exposes __composerySetScheme to fire them on a live theme flip (no reload).
// Non-color queries pass through, so the narrow/touch gates are untouched.
export function buildBeforeLoad(scheme: "light" | "dark"): string {
	return `
window.__composeryNative = true;
window.__composeryScheme = ${JSON.stringify(scheme)};
(function () {
	if (!window.matchMedia || window.__composeryMatchMediaPatched) return;
	window.__composeryMatchMediaPatched = true;
	var real = window.matchMedia.bind(window);
	var listeners = [];
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
		var ev = { matches: window.__composeryScheme === "dark", media: "(prefers-color-scheme: dark)" };
		listeners.slice().forEach(function (cb) { try { cb.call(null, ev); } catch (e) {} });
	};
})();
true;`;
}

// Runs after load: installs the back control into the title bar's left slot and
// reports the live title-bar background so the app can tint the status-bar strip
// to match any IDE theme. Styled 1:1 with the IDE's own title-bar icon buttons
// (16px codicon, 22px box, 6px radius, toolbar hover/active bg) so it blends in.
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
		// Matches .action-label.codicon: 16px icon, 22px box, 6px radius, toolbar
		// hover/active bg. z-index clears the absolute .titlebar-drag-region; the
		// tap-highlight resets kill the WebView's bluish press flash. The .menubar
		// rules shrink the overflow hamburger to the same 22px box so they pair.
		s.textContent =
			"#" + ID + "{box-sizing:border-box;display:flex;align-items:center;justify-content:center;align-self:center;" +
			"width:22px;height:22px;padding:3px;margin:0 2px 0 5px;border:0;border-radius:6px;background:transparent;" +
			"color:var(--vscode-titleBar-activeForeground,#888);cursor:pointer;-webkit-app-region:no-drag;position:relative;z-index:2500;" +
			"outline:none;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;}" +
			"#" + ID + ":hover{background:var(--vscode-toolbar-hoverBackground,rgba(184,184,184,0.31));}" +
			"#" + ID + ":active{background:var(--vscode-toolbar-activeBackground,rgba(166,166,166,0.31));}" +
			"#" + ID + " svg{display:block;width:16px;height:16px;}" +
			".part.titlebar .titlebar-left .menubar{padding-left:0!important;padding-right:0!important;}" +
			".part.titlebar .titlebar-left .menubar-menu-button{width:22px!important;min-width:22px!important;padding:0!important;}" +
			".part.titlebar .titlebar-left .menubar-menu-button .menubar-menu-title{transform:translateY(1px);}";
		(document.head || document.documentElement).appendChild(s);
	}

	function button() {
		var b = document.createElement("button");
		b.id = ID;
		b.type = "button";
		b.setAttribute("aria-label", "Back to instances");
		b.setAttribute("title", "Back to instances");
		// VS Code codicon arrow-left (fill currentColor).
		b.innerHTML = '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true"><path d="M13.5 8.00023H3.70701L7.85301 3.85423C8.04801 3.65923 8.04801 3.34223 7.85301 3.14723C7.65801 2.95223 7.34101 2.95223 7.14601 3.14723L2.14601 8.14723C1.95101 8.34223 1.95101 8.65923 2.14601 8.85423L7.14601 13.8542C7.24401 13.9522 7.37201 14.0002 7.50001 14.0002C7.62801 14.0002 7.75601 13.9512 7.85401 13.8542C8.04901 13.6592 8.04901 13.3422 7.85401 13.1472L3.70801 9.00123H13.501C13.777 9.00123 14.001 8.77723 14.001 8.50123C14.001 8.22523 13.777 8.00123 13.501 8.00123L13.5 8.00023Z"/></svg>';
		b.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); post("composery:back"); });
		return b;
	}

	function placeTitlebar() {
		var left = document.querySelector(TITLEBAR);
		if (!left || document.getElementById(ID)) return;
		ensureStyle();
		var logo = left.querySelector(APPICON);
		if (logo) logo.style.display = "none";
		left.insertBefore(button(), left.firstChild);
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

	var scheduled = false;
	function schedule() {
		if (scheduled) return;
		scheduled = true;
		requestAnimationFrame(function () { scheduled = false; placeTitlebar(); readBg(); });
	}

	schedule();
	new MutationObserver(schedule).observe(document.documentElement, {
		attributes: true, childList: true, subtree: true
	});
})();
true;`;
