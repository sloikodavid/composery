(function () {
	// The tab icon follows the editor's theme the moment it changes, the way
	// github.com and polar.sh do it - no reload.
	//
	// The declared favicon.svg carries its own prefers-color-scheme rule, but
	// Chromium rasterizes a favicon once per URL and never re-runs that query, so
	// on its own the icon only ever catches up across a reload. Pointing the link
	// at a scheme-pinned file is a new URL, which every browser does re-render.
	// The adaptive file stays declared: it is what the frames before the workbench
	// exists get, and what a JS-less client gets.
	//
	// The workbench's own theme class is the scheme, not prefers-color-scheme:
	// with window.autoDetectColorScheme the theme follows the OS anyway, and when
	// the user picks a theme that disagrees with the OS the tab belongs to the
	// editor they are looking at. Mirrors (cannot import) ThemeTypeSelector.
	const DARK_THEME_CLASSES = ["vs-dark", "hc-black"];
	const LIGHT_THEME_CLASSES = ["vs", "hc-light"];
	const WORKBENCH_SELECTOR = ".monaco-workbench";

	const link = document.querySelector("link[rel=icon][data-light][data-dark]");
	if (!link) return;

	const scheme = window.matchMedia("(prefers-color-scheme: dark)");

	function workbenchDark(workbench) {
		if (DARK_THEME_CLASSES.some((name) => workbench.classList.contains(name))) {
			return true;
		}
		if (LIGHT_THEME_CLASSES.some((name) => workbench.classList.contains(name))) {
			return false;
		}
		// Themed classes are applied asynchronously, so an untyped workbench is a
		// frame before the theme, not a light one. Keep whatever is on screen.
		return null;
	}

	function apply() {
		const workbench = document.querySelector(WORKBENCH_SELECTOR);
		const dark = workbench ? workbenchDark(workbench) : scheme.matches;
		if (dark === null) return;
		link.href = dark ? link.dataset.dark : link.dataset.light;
	}

	// Watch the workbench element's class once it exists; until then it can land
	// anywhere in the document, so the wait is document-wide and short-lived.
	function watchWorkbench() {
		const workbench = document.querySelector(WORKBENCH_SELECTOR);
		if (!workbench) return false;
		new MutationObserver(apply).observe(workbench, {
			attributeFilter: ["class"],
		});
		apply();
		return true;
	}

	if (!watchWorkbench()) {
		const waiting = new MutationObserver(function () {
			if (watchWorkbench()) waiting.disconnect();
		});
		waiting.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
	}

	// Catches an OS flip in the frames before the workbench exists; once it does,
	// apply() reads its theme class and this listener stops mattering (the
	// workbench re-themes itself on an OS flip when autoDetectColorScheme is on).
	scheme.addEventListener("change", apply);
	apply();
})();
