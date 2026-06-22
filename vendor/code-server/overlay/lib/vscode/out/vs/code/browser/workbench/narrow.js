(function () {
	// Narrow-viewport (any small screen, mouse or touch) DOM housekeeping - the imperative half of
	// narrow.css. Mirrors (cannot import) narrowGate.ts NARROW_QUERY; keep the breakpoint in sync.
	const NARROW_MAX_WIDTH = 768;
	const narrow = window.matchMedia(`(max-width: ${NARROW_MAX_WIDTH}px)`);
	let pending = false;
	let latePasses = [];
	let overlayBackGuardArmed = false;
	let overlayBackGuardDisarming = false;
	const modalEditorNarrowAttribute = "data-composery-narrow-maximized";
	const modalEditorMaximizePendingAttribute =
		"data-composery-narrow-maximize-pending";

	const overlaySelectors = [
		".monaco-menu-container",
		".action-list-submenu-panel",
		".quick-input-widget",
		".monaco-hover:not(.hidden)",
		".editor-widget",
		".suggest-details-container",
		".monaco-dialog-modal-block",
		".monaco-modal-editor-block",
		".notifications-center",
		".notification-toast-container",
		".context-view",
		".monaco-dialog-box",
		".suggest-widget",
		".parameter-hints-widget",
		".rename-box",
		".find-widget",
	];
	const modalEditorMaximizeSelector =
		".monaco-modal-editor-block .modal-editor-action-container .action-label.codicon-screen-full";

	function updateViewportVars() {
		const viewport = window.visualViewport;
		const height = viewport?.height ?? window.innerHeight;
		const width = viewport?.width ?? window.innerWidth;
		const keyboardInsetBottom = viewport
			? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
			: 0;
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
	}

	function activeOverlay() {
		if (!narrow.matches) {
			return null;
		}

		for (const selector of overlaySelectors) {
			for (const element of document.querySelectorAll(selector)) {
				if (!(element instanceof HTMLElement)) {
					continue;
				}

				const style = getComputedStyle(element);
				const rect = element.getBoundingClientRect();
				if (
					style.display !== "none" &&
					style.visibility !== "hidden" &&
					rect.width > 0 &&
					rect.height > 0
				) {
					return element;
				}
			}
		}

		return null;
	}

	function dispatchEscape() {
		const target =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: document.body;
		const eventInit = {
			key: "Escape",
			code: "Escape",
			keyCode: 27,
			which: 27,
			bubbles: true,
			cancelable: true,
		};

		target.dispatchEvent(new KeyboardEvent("keydown", eventInit));
		target.dispatchEvent(new KeyboardEvent("keyup", eventInit));
	}

	function updateOverlayBackGuard() {
		const overlay = activeOverlay();
		if (overlay && !overlayBackGuardArmed) {
			overlayBackGuardArmed = true;
			history.pushState({ composeryOverlayBackGuard: true }, "", location.href);
			return;
		}

		if (overlay || !overlayBackGuardArmed) {
			return;
		}

		overlayBackGuardArmed = false;
		if (history.state?.composeryOverlayBackGuard) {
			overlayBackGuardDisarming = true;
			history.back();
		}
	}

	function handleOverlayBack() {
		if (overlayBackGuardDisarming) {
			overlayBackGuardDisarming = false;
			return;
		}

		if (!overlayBackGuardArmed) {
			return;
		}

		overlayBackGuardArmed = false;
		if (activeOverlay()) {
			dispatchEscape();
			window.setTimeout(updateOverlayBackGuard, 100);
		}
	}

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
		updateOverlayBackGuard();
		updateModalEditorNarrowState();
	}

	function schedule() {
		if (!pending) {
			pending = true;
			window.requestAnimationFrame(enforce);
		}
	}

	function scheduleAfterInteraction() {
		for (const pass of latePasses) {
			window.clearTimeout(pass);
		}
		latePasses = [];

		schedule();
		window.requestAnimationFrame(schedule);
		latePasses.push(window.setTimeout(schedule, 120));
		latePasses.push(window.setTimeout(schedule, 360));
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

	document.addEventListener("click", scheduleAfterInteraction, true);
	document.addEventListener("dblclick", blockNarrowModalEditorRestore, true);
	window.addEventListener("popstate", handleOverlayBack);
	window.addEventListener("resize", schedule);
	window.visualViewport?.addEventListener("resize", schedule);
	window.visualViewport?.addEventListener("scroll", schedule);
	narrow.addEventListener("change", handleNarrowChange);

	updateViewportVars();
	window.setTimeout(schedule, 500);
	window.setTimeout(schedule, 1500);
})();
