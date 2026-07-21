// The tab icon follows the colour scheme the moment it changes, the way
// github.com and polar.sh do it - no reload.
//
// The declared favicon.svg carries its own prefers-color-scheme rule, but
// Chromium rasterizes a favicon once per URL and never re-runs that query, so on
// its own the icon only ever catches up across a reload. Pointing the link at a
// scheme-pinned file is a new URL, which every browser does re-render. The
// adaptive file stays declared: it is what the first paint and a JS-less client
// get, and what Firefox keeps re-evaluating by itself.
//
// The scheme comes from matchMedia rather than a CSS query on purpose: the
// mobile app shims matchMedia to report the app scheme, because an Android
// WebView's native prefers-color-scheme tracks the activity theme, not the
// system one.
(() => {
	const link = document.querySelector("link[rel=icon][data-light][data-dark]")
	if (!link) return

	const dark = window.matchMedia("(prefers-color-scheme: dark)")
	const apply = () => {
		link.href = dark.matches ? link.dataset.dark : link.dataset.light
	}

	dark.addEventListener("change", apply)
	apply()
})()
