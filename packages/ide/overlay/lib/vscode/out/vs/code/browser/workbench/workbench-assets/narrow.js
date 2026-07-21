(function () {
	// Narrow-viewport (any small screen, mouse or touch) DOM housekeeping - the imperative half of
	// narrow.css. Mirrors (cannot import) narrowGate.ts NARROW_QUERY; keep the breakpoint in sync.
	const NARROW_MAX_WIDTH = 768;
	const narrow = window.matchMedia(`(max-width: ${NARROW_MAX_WIDTH}px)`);
	const coarsePointer = window.matchMedia("(pointer: coarse)");
	let pending = false;
	// Our sentinel history entry is the current one (browser back gesture only - the
	// native app never walks WebView history, see syncBackGuard).
	let backGuardArmed = false;
	// history.back() calls WE issued to retire a sentinel. Counted, not a flag: a
	// layer can reopen while one is still in flight, and the resulting popstate
	// must be recognised as ours and then re-armed, or the guard is left believing
	// in a sentinel that is no longer there and the next back leaves the page.
	let pendingBackGuardDisarms = 0;
	// The layer we last asked to close, and one that refused to (see dismissTopLayer).
	let dismissing = null;
	let undismissable = null;
	// Last layer state sent to the app. Starts false to match the app's own initial
	// state, so the first message is a real change and not an echo of it.
	let reportedLayerOpen = false;
	const modalEditorNarrowAttribute = "data-composery-narrow-maximized";
	const modalEditorMaximizePendingAttribute =
		"data-composery-narrow-maximize-pending";
	// Mirrors (cannot import) the listener in narrow-fullscreen.diff; keep in sync.
	const narrowClosePartEvent = "composery-narrow-close-part";
	// Mirror of layout.ts part-hidden workbench classes; their absence means the part is open.
	const partHiddenClasses = ["nosidebar", "nopanel", "noauxiliarybar"];
	const keyboardInsetProbe = document.createElement("div");

	// The layers a back gesture peels, top first. Every entry must be something the
	// user opened and that an Escape actually closes - back is a dismissal, not a
	// wildcard "close whatever is on screen".
	//
	// Deliberately absent:
	// - .notification-toast-container: a toast arrives unasked and expires on its
	//   own. Listing it spent the user's back press on a banner they were not
	//   interacting with, leaving the part they meant to close open.
	// - .editor-widget: the class every editor widget shares, so it matched
	//   whatever upstream adds next, dismissable or not - and a back press absorbed
	//   by a widget that does NOT close on Escape reads as a dead press. The
	//   dismissable editor widgets we mean are named individually below instead.
	const overlaySelectors = [
		".monaco-menu-container",
		".action-list-submenu-panel",
		".quick-input-widget",
		".monaco-dialog-modal-block",
		".monaco-dialog-box",
		".monaco-modal-editor-block",
		".notifications-center",
		".context-view",
		".monaco-hover:not(.hidden)",
		".suggest-widget",
		".suggest-details-container",
		".parameter-hints-widget",
		".rename-box",
		".find-widget",
		// The standalone color picker is a content widget over the editor with its
		// own close button and Escape handler, and it renders outside .context-view -
		// so replacing the blanket .editor-widget match with named widgets left it
		// the one dismissable editor popup back could not reach.
		".standalone-colorpicker",
		// Widgets that open inside the editor and take it over - peek references,
		// test peek, the merge conflict and inline chat widgets. Lower than the
		// popups above, which sit on top of them, and higher than a full-screen part,
		// which sits under the editor holding them.
		".zone-widget",
	];
	const modalEditorMaximizeSelector =
		".monaco-modal-editor-block .modal-editor-action-container .action-label.codicon-screen-full";

	keyboardInsetProbe.style.cssText =
		"position:fixed;left:-9999px;bottom:0;width:1px;height:env(keyboard-inset-height,0px);pointer-events:none;visibility:hidden;";
	keyboardInsetProbe.setAttribute("aria-hidden", "true");

	function ensureKeyboardInsetProbe() {
		if (keyboardInsetProbe.isConnected) {
			return;
		}

		(document.body || document.documentElement).appendChild(keyboardInsetProbe);
	}

	function envKeyboardInset() {
		ensureKeyboardInsetProbe();
		return keyboardInsetProbe.offsetHeight;
	}

	function bottomKeyboardOverlap(rect) {
		if (!rect?.height) {
			return 0;
		}

		const top = rect.y ?? rect.top ?? window.innerHeight;
		const bottom = rect.bottom ?? top + rect.height;
		if (bottom < window.innerHeight - 1) {
			return 0;
		}

		return Math.max(0, Math.round(window.innerHeight - top));
	}

	function virtualKeyboardInset() {
		const keyboard = navigator.virtualKeyboard;
		if (!keyboard?.overlaysContent) {
			return 0;
		}

		return bottomKeyboardOverlap(keyboard.boundingRect);
	}

	function visualViewportKeyboardInset(viewport) {
		return viewport
			? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
			: 0;
	}

	// With interactive-widget=resizes-content the keyboard shrinks the LAYOUT viewport too, so
	// innerHeight - visualViewport.height reads 0 and none of the insets above can see it. The
	// tallest viewport seen at this width is therefore the keyboard-down baseline; anything
	// enough shorter than it is the keyboard. The floor keeps browser chrome (the collapsing
	// URL bar) from reading as one.
	const KEYBOARD_MIN_INSET = 120;
	let keyboardBaselineWidth = 0;
	let keyboardBaselineHeight = 0;

	function keyboardOpen(width, height) {
		if (width !== keyboardBaselineWidth) {
			keyboardBaselineWidth = width;
			keyboardBaselineHeight = height;
		} else if (height > keyboardBaselineHeight) {
			keyboardBaselineHeight = height;
		}

		return keyboardBaselineHeight - height >= KEYBOARD_MIN_INSET;
	}

	function updateViewportVars() {
		const viewport = window.visualViewport;
		const height = viewport?.height ?? window.innerHeight;
		const width = viewport?.width ?? window.innerWidth;
		const keyboardInsetBottom = Math.max(
			visualViewportKeyboardInset(viewport),
			virtualKeyboardInset(),
			envKeyboardInset(),
		);
		const rootStyle = document.documentElement.style;

		rootStyle.setProperty(
			"--composery-viewport-height",
			`${Math.round(height)}px`,
		);
		rootStyle.setProperty(
			"--composery-viewport-width",
			`${Math.round(width)}px`,
		);
		rootStyle.setProperty(
			"--composery-touch-keyboard-inset",
			`${Math.round(keyboardInsetBottom)}px`,
		);
		// Read by terminalInstance.ts to keep the terminal grid at its keyboard-down size:
		// a keyboard must occlude the terminal, never resize the pty (SIGWINCH storms
		// re-lay-out every TUI). Separate from the inset above, which means "overlap the
		// viewport has NOT already excluded" and stays 0 here.
		rootStyle.setProperty(
			"--composery-touch-keyboard-open",
			keyboardOpen(Math.round(width), Math.round(height)) ? "1" : "0",
		);
	}

	function onScreen(element) {
		if (!(element instanceof HTMLElement) || !element.isConnected) {
			return false;
		}

		const style = getComputedStyle(element);
		if (style.display === "none" || style.visibility === "hidden") {
			return false;
		}

		const rect = element.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	}

	function activeOverlay() {
		// A rotated phone can exceed the narrow layout breakpoint while still using
		// Android hardware Back. Keep transient IDE layers in the WebView history
		// on coarse-pointer devices at every orientation; full-screen workbench
		// parts below remain narrow-specific.
		if (!narrow.matches && !coarsePointer.matches) {
			return null;
		}

		for (const selector of overlaySelectors) {
			for (const element of document.querySelectorAll(selector)) {
				if (element !== undismissable && onScreen(element)) {
					return element;
				}
			}
		}

		return null;
	}

	// A narrow-fullscreen part (side bar / panel / secondary side bar, kept exclusive by
	// narrow-fullscreen.diff) counts as a back-dismissible layer too - below every transient
	// overlay, so back peels the stack: menu first, then the open part, then the page.
	function narrowPartOpen() {
		if (!narrow.matches) {
			return false;
		}

		const workbench = document.querySelector(".monaco-workbench");
		if (!(workbench instanceof HTMLElement)) {
			return false;
		}

		return partHiddenClasses.some(
			(hiddenClass) => !workbench.classList.contains(hiddenClass),
		);
	}

	// Stands in for the open full-screen part the way an element stands in for an
	// overlay, so both kinds of layer move through the same dismissal bookkeeping.
	const PART = "part";

	// The topmost thing back would close, or null when back belongs to the host.
	function activeBackTarget() {
		const overlay = activeOverlay();
		if (overlay) {
			return overlay;
		}

		if (undismissable !== PART && narrowPartOpen()) {
			return PART;
		}

		return null;
	}

	function stillPresent(target) {
		return target === PART ? narrowPartOpen() : onScreen(target);
	}

	// VS Code reads e.keyCode and nothing else (base/browser/keyboardEvent.ts
	// extractKeyCode), and keyCode is a legacy KeyboardEventInit member no engine
	// is obliged to honour - where it is dropped the event arrives as keyCode 0,
	// resolves to KeyCode.Unknown and matches no keybinding, so every dismissal
	// below would silently do nothing. Define it back on when the constructor
	// swallowed it, rather than trusting the engine.
	function escapeEvent(type) {
		const event = new KeyboardEvent(type, {
			key: "Escape",
			code: "Escape",
			keyCode: 27,
			which: 27,
			bubbles: true,
			cancelable: true,
		});

		if (event.keyCode !== 27) {
			Object.defineProperty(event, "keyCode", { get: () => 27 });
			Object.defineProperty(event, "which", { get: () => 27 });
		}

		return event;
	}

	// Aim the Escape at the focused element when the layer owns focus (the widget's
	// own handler expects it there), and at the layer itself otherwise - a menu
	// opened by touch often leaves focus behind in the editor, and an Escape
	// delivered to the body would be resolved against the body's context keys and
	// close nothing.
	function dispatchEscape(overlay) {
		const active =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const target =
			active && (!overlay || overlay.contains(active)) ? active : overlay;
		const element = target ?? document.body;

		element.dispatchEvent(escapeEvent("keydown"));
		element.dispatchEvent(escapeEvent("keyup"));
	}

	// A layer that ignores its Escape must not swallow every later back press: once
	// it has had the grace period below, stop counting it as a layer for as long as
	// it stays on screen, so the guard disarms and the next back does the thing
	// underneath instead of nothing at all.
	const DISMISS_GRACE = 500;

	// Close the topmost layer. Returns whether there was one - false means back
	// belongs to whoever is hosting the page (leave for the instance list in the
	// app, leave the page in a browser).
	function dismissTopLayer() {
		const target = activeBackTarget();
		if (!target) {
			dismissing = null;
			return false;
		}

		dismissing = { target, at: Date.now() };
		if (target === PART) {
			window.dispatchEvent(new Event(narrowClosePartEvent));
		} else {
			dispatchEscape(target);
		}

		// A layer that refuses to close mutates nothing, so nothing would wake the
		// observer to notice: come back for the verdict ourselves.
		window.setTimeout(schedule, DISMISS_GRACE + 50);
		return true;
	}

	function reviewDismissal() {
		if (undismissable && !stillPresent(undismissable)) {
			undismissable = null;
		}

		if (!dismissing) {
			return;
		}

		if (
			!stillPresent(dismissing.target) ||
			dismissing.target !== activeBackTarget()
		) {
			dismissing = null;
			return;
		}

		if (Date.now() - dismissing.at > DISMISS_GRACE) {
			undismissable = dismissing.target;
			dismissing = null;
		}
	}

	function postNative(message) {
		if (!window.__composeryNative || !window.ReactNativeWebView?.postMessage) {
			return;
		}

		try {
			window.ReactNativeWebView.postMessage(message);
		} catch {}
	}

	function nativeHost() {
		return Boolean(
			window.__composeryNative && window.ReactNativeWebView?.postMessage,
		);
	}

	function syncBackGuard() {
		reviewDismissal();
		const target = activeBackTarget();

		// In the app the back press is delivered to us directly, so there is no
		// sentinel to keep: history stays exactly as the workbench left it and a back
		// can never walk it. All the app needs is whether this press has a layer to
		// spend itself on or should leave the screen - on the transitions only, since
		// this runs on every workbench mutation and a live terminal produces them by
		// the hundred.
		if (nativeHost()) {
			const open = Boolean(target);
			if (open !== reportedLayerOpen) {
				reportedLayerOpen = open;
				postNative(`composery:overlay-back:${open ? "on" : "off"}`);
			}
			return;
		}

		if (target) {
			if (!backGuardArmed) {
				backGuardArmed = true;
				// A reload (or a restored WebView) keeps session history, so a previous
				// sentinel can already be the current entry - adopt it instead of stacking
				// a second one, or back presses accumulate across reloads.
				if (!history.state?.composeryBackGuard) {
					history.pushState({ composeryBackGuard: true }, "", location.href);
				}
			}
			return;
		}

		if (backGuardArmed) {
			backGuardArmed = false;
			if (history.state?.composeryBackGuard) {
				pendingBackGuardDisarms++;
				history.back();
			}
		}
	}

	function handleBackGuardPop() {
		if (pendingBackGuardDisarms > 0) {
			pendingBackGuardDisarms--;
			backGuardArmed = false;
			// A layer can have opened while our history.back() was in flight, and it
			// would have adopted the sentinel this pop just retired. Re-arm against the
			// history we actually have now.
			syncBackGuard();
			return;
		}

		if (!backGuardArmed) {
			return;
		}

		backGuardArmed = false;
		dismissTopLayer();
		// Re-arm synchronously: this pop retired the sentinel, so until one is back a
		// second browser back reaches real navigation and leaves the page (device-seen
		// 2026-07-21: a back with a menu over an open panel closed the menu, then the
		// next back hit Chrome's "Leave site?" instead of closing the panel). A layer
		// closed by Escape is gone from the DOM by now, so activeBackTarget already
		// reflects the layer beneath it, and syncBackGuard re-plants the sentinel while
		// that layer is still open. The app never gets here - it has no sentinel.
		syncBackGuard();
		// And again once a layer that closes on an animation rather than synchronously
		// has finished, in case the pass above re-armed against one that is now gone.
		window.setTimeout(syncBackGuard, 100);
	}

	// The app's hardware/gesture back. Same ladder as the browser guard above, minus
	// the history round trip: dismiss the top layer, or tell the app there was none
	// so it leaves for the instance list. Defined for every host so the app can call
	// it without knowing which page it landed on.
	window.__composeryNativeBack = function () {
		reviewDismissal();
		const dismissed = dismissTopLayer();
		if (!dismissed) {
			postNative("composery:back");
		}

		schedule();
		return dismissed;
	};

	function updateModalEditorNarrowState() {
		for (const action of document.querySelectorAll(modalEditorMaximizeSelector)) {
			if (!(action instanceof HTMLElement)) {
				continue;
			}

			const modal = action.closest(".monaco-modal-editor-block");
			if (!(modal instanceof HTMLElement)) {
				continue;
			}

			if (!narrow.matches) {
				modal.removeAttribute(modalEditorNarrowAttribute);
				modal.removeAttribute(modalEditorMaximizePendingAttribute);
				continue;
			}

			const maximized = action.getAttribute("aria-pressed") === "true";
			if (maximized) {
				modal.setAttribute(modalEditorNarrowAttribute, "true");
				modal.removeAttribute(modalEditorMaximizePendingAttribute);
				continue;
			}

			if (modal.getAttribute(modalEditorMaximizePendingAttribute) !== "true") {
				modal.setAttribute(modalEditorMaximizePendingAttribute, "true");
				modal.setAttribute(modalEditorNarrowAttribute, "true");
				action.click();
			}
		}
	}

	function blockNarrowModalEditorRestore(event) {
		if (!narrow.matches || !(event.target instanceof Element)) {
			return;
		}

		if (event.target.closest(".monaco-modal-editor-block .modal-editor-header")) {
			event.preventDefault();
			event.stopPropagation();
		}
	}

	// DOM housekeeping that has to react to workbench mutations. The fullscreen single-part
	// coordination lives natively in the workbench Layout (narrow-fullscreen.diff), not here.
	function enforce() {
		pending = false;
		updateViewportVars();
		syncBackGuard();
		updateModalEditorNarrowState();
	}

	function schedule() {
		if (!pending) {
			pending = true;
			window.requestAnimationFrame(enforce);
		}
	}

	function handleNarrowChange() {
		updateViewportVars();
		updateModalEditorNarrowState();
		schedule();
	}

	new MutationObserver(schedule).observe(document.documentElement, {
		attributes: true,
		childList: true,
		subtree: true,
	});

	// Geometry listeners refresh the viewport vars SYNCHRONOUSLY: this script loads
	// before workbench.js, so its listeners run first within the same resize event,
	// and the workbench layout fit (touch-viewport-inset.diff) reads
	// --composery-touch-keyboard-inset in its own listener - an async (rAF) update
	// would leave it a stale keyboard inset and wedge the workbench at the
	// keyboard-open height after the keyboard closes.
	function handleViewportGeometry() {
		updateViewportVars();
		schedule();
	}

	document.addEventListener("dblclick", blockNarrowModalEditorRestore, true);
	// Re-evaluate viewport vars and the back guard when the app/tab returns to the
	// foreground - the OS may have closed the keyboard or resized while backgrounded.
	document.addEventListener("visibilitychange", handleViewportGeometry);
	window.addEventListener("popstate", handleBackGuardPop);
	window.addEventListener("resize", handleViewportGeometry);
	window.visualViewport?.addEventListener("resize", handleViewportGeometry);
	window.visualViewport?.addEventListener("scroll", handleViewportGeometry);
	navigator.virtualKeyboard?.addEventListener("geometrychange", handleViewportGeometry);
	narrow.addEventListener("change", handleNarrowChange);

	updateViewportVars();
	window.setTimeout(schedule, 500);
	window.setTimeout(schedule, 1500);
})();
