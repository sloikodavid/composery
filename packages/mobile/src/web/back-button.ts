// Scripts injected into the instance WebView, kept here (not inline) so the
// wiring is unit-tested and the selector can't drift from the IDE.
//
// We don't build our own back control: the title bar already carries the
// Composery logo (`.window-appicon`), and titlebar-logo.diff renders it on every
// web platform (keyed on isWeb, so it exists on iOS too, which the WebView
// reports as Macintosh). We reuse that one brand mark as the Home button —
// native-only, we intercept its click and post `composery:back` so the app pops
// to the instances list instead of following the website link it carries in a
// desktop browser.

export const WORKBENCH_SELECTOR = ".monaco-workbench";
export const APPICON_SELECTOR = ".window-appicon";

export type Placement = "appicon" | "wait";

// Wire the Home action once the logo exists; until then wait (the workbench
// builds the title bar async, and the observer retries).
export function choosePlacement(state: { hasAppIcon: boolean }): Placement {
	return state.hasAppIcon ? "appicon" : "wait";
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

// Runs after load: turns the title bar's Composery logo into the Home button and
// reports the live title-bar background so the app can tint the status-bar strip
// to match any IDE theme.
export const INSTALL_SCRIPT = `(function () {
	var APPICON = ${JSON.stringify(APPICON_SELECTOR)};
	var WORKBENCH = ${JSON.stringify(WORKBENCH_SELECTOR)};
	var lastBg = "";

	function post(m) { try { window.ReactNativeWebView.postMessage(m); } catch (e) {} }

	function wireHome() {
		var icon = document.querySelector(APPICON);
		if (!icon || icon.__composeryHomeBound) return;
		icon.__composeryHomeBound = true;
		// It ships as an <a> to the website; in the app it's the Home button.
		icon.setAttribute("aria-label", "Home");
		icon.setAttribute("title", "Home");
		icon.style.webkitTouchCallout = "none";
		// Capture + stop so the anchor never navigates and no other titlebar
		// handler runs; posting up lets the app pop to the instances list.
		icon.addEventListener("click", function (e) {
			e.preventDefault(); e.stopPropagation(); post("composery:back");
		}, true);
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
		requestAnimationFrame(function () { scheduled = false; wireHome(); readBg(); });
	}

	schedule();
	new MutationObserver(schedule).observe(document.documentElement, {
		attributes: true, childList: true, subtree: true
	});
})();
true;`;
