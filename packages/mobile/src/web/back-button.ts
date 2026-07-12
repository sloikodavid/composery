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
		// The button's real siblings in .titlebar-left are MENUBAR buttons, so it
		// uses the menubar token family (selectionBackground/Foreground, 5px radius
		// like .menubar-menu-title), not toolbar tokens - plus the states the
		// titlebar's own controls have: inactive-window foreground, focusBorder
		// focus ring, and hover gated on (hover:hover) so a tap can't leave a
		// stuck hover wash on touch. z-index clears the absolute
		// .titlebar-drag-region; the tap-highlight resets kill the WebView's
		// bluish press flash. The .menubar rules shrink the overflow hamburger to
		// the same 22px box so they pair.
		s.textContent =
			"#" + ID + "{box-sizing:border-box;display:flex;align-items:center;justify-content:center;align-self:center;" +
			"width:22px;height:22px;padding:3px;margin:0 2px 0 5px;border:0;border-radius:5px;background:transparent;" +
			"color:var(--vscode-titleBar-activeForeground,#888);cursor:pointer;-webkit-app-region:no-drag;position:relative;z-index:2500;" +
			"outline:none;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;user-select:none;-webkit-user-select:none;}" +
			".part.titlebar.inactive #" + ID + "{color:var(--vscode-titleBar-inactiveForeground,#888);}" +
			"@media (hover: hover){#" + ID + ":hover{" +
			"background:var(--vscode-menubar-selectionBackground,var(--vscode-toolbar-hoverBackground,rgba(184,184,184,0.31)));" +
			"color:var(--vscode-menubar-selectionForeground,var(--vscode-titleBar-activeForeground,#888));}}" +
			"#" + ID + ":active{background:var(--vscode-menubar-selectionBackground,var(--vscode-toolbar-activeBackground,rgba(166,166,166,0.31)));}" +
			"#" + ID + ":focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:-1px;}" +
			"#" + ID + " .codicon{font-size:16px;line-height:16px;}" +
			".part.titlebar .titlebar-left .menubar{padding-left:0!important;padding-right:0!important;}" +
			// Only the overflow (hamburger) button gets the 22px pairing box. A bare
			// .menubar-menu-button selector would force File/Edit/... to 22px too,
			// which also poisons the menubar's own overflow measurement (it reads
			// offsetWidth), so no label ever moves into the overflow menu.
			".part.titlebar .titlebar-left .menubar-menu-button:has(.toolbar-toggle-more){width:22px!important;min-width:22px!important;padding:0!important;}" +
			".part.titlebar .titlebar-left .menubar-menu-button .menubar-menu-title.toolbar-toggle-more{transform:translateY(1px);}";
		(document.head || document.documentElement).appendChild(s);
	}

	function button() {
		var b = document.createElement("button");
		b.id = ID;
		b.type = "button";
		b.setAttribute("aria-label", "Back to instances");
		b.setAttribute("title", "Back to instances");
		// The workbench's own codicon font (placement only ever happens on the
		// workbench page, where it's loaded) keeps the control native to the IDE.
		b.innerHTML = '<span class="codicon codicon-arrow-left" aria-hidden="true"></span>';
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
