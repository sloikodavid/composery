(function () {
	// Touch-pointer (any touch device, any screen size) DOM housekeeping - the imperative half of
	// touch.css. Mirrors (cannot import) touchGate.ts TOUCH_QUERY; keep the query in sync.
	const touchLike = window.matchMedia("(hover: none), (any-pointer: coarse)");
	let pending = false;
	let horizontalPan = null;
	let horizontalScrollbarDrag = null;

	const keybindingsTableContainerSelector = ".keybindings-table-container";
	const keybindingsScrollSelector =
		`.keybindings-editor > .keybindings-body > ${keybindingsTableContainerSelector}`;
	const horizontalPanSelectors = [
		".settings-editor .monaco-split-view2.horizontal > .monaco-scrollable-element > .split-view-container",
		".profiles-editor > .monaco-split-view2.horizontal > .monaco-scrollable-element > .split-view-container",
		keybindingsScrollSelector,
	];

	function browserPinchWheel(event) {
		return (
			event.ctrlKey &&
			!event.metaKey &&
			!event.shiftKey &&
			!event.altKey
		);
	}

	function releaseBrowserZoomGesture(event) {
		if (browserPinchWheel(event)) {
			event.stopPropagation();
		}
	}

	function maxScrollLeft(container) {
		return Math.max(0, container.scrollWidth - container.clientWidth);
	}

	function setScrollLeft(container, scrollLeft) {
		const nextScrollLeft = Math.max(
			0,
			Math.min(maxScrollLeft(container), scrollLeft),
		);

		if (container.scrollLeft !== nextScrollLeft) {
			container.scrollLeft = nextScrollLeft;
			updateKeybindingsScrollbar(container);
			return true;
		}

		return false;
	}

	function keybindingsScrollContainer(target) {
		if (!(target instanceof Element)) {
			return null;
		}

		const container = target.closest(keybindingsScrollSelector);
		return container instanceof HTMLElement ? container : null;
	}

	function ensureKeybindingsScrollbar(container) {
		const body = container.parentElement;
		if (!(body instanceof HTMLElement)) {
			return null;
		}

		let scrollbar = body.querySelector(":scope > .composery-keybindings-scrollbar");
		if (scrollbar instanceof HTMLElement) {
			return scrollbar;
		}

		scrollbar = document.createElement("div");
		scrollbar.className =
			"composery-keybindings-scrollbar scrollbar horizontal";
		scrollbar.setAttribute("role", "presentation");
		scrollbar.setAttribute("aria-hidden", "true");

		const slider = document.createElement("div");
		slider.className = "slider";
		scrollbar.append(slider);
		body.append(scrollbar);

		return scrollbar;
	}

	function updateKeybindingsScrollbar(container) {
		if (!container.matches(keybindingsScrollSelector)) {
			return;
		}

		const scrollbar = ensureKeybindingsScrollbar(container);
		if (!scrollbar) {
			return;
		}

		const slider = scrollbar.querySelector(":scope > .slider");
		if (!(slider instanceof HTMLElement)) {
			return;
		}

		const maxLeft = maxScrollLeft(container);
		if (maxLeft <= 1 || container.clientWidth <= 0) {
			scrollbar.classList.add("hidden");
			return;
		}

		scrollbar.classList.remove("hidden");
		const trackWidth = container.clientWidth;
		const sliderWidth = Math.max(
			20,
			Math.round((trackWidth / container.scrollWidth) * trackWidth),
		);
		const sliderLeft = Math.round(
			(container.scrollLeft / maxLeft) * (trackWidth - sliderWidth),
		);

		slider.style.width = `${sliderWidth}px`;
		slider.style.transform = `translate3d(${sliderLeft}px, 0, 0)`;
	}

	function updateKeybindingsScrollbars() {
		for (const container of document.querySelectorAll(keybindingsScrollSelector)) {
			if (container instanceof HTMLElement) {
				updateKeybindingsScrollbar(container);
			}
		}
	}

	function handleHorizontalWheel(event) {
		if (browserPinchWheel(event)) {
			return;
		}

		const absX = Math.abs(event.deltaX);
		const absY = Math.abs(event.deltaY);
		if (absX <= absY || absX < 1) {
			return;
		}

		const container = keybindingsScrollContainer(event.target);
		if (!container || maxScrollLeft(container) <= 1) {
			return;
		}

		if (setScrollLeft(container, container.scrollLeft + event.deltaX)) {
			event.preventDefault();
			event.stopPropagation();
		}
	}

	// Finger-pan of horizontally-overflowing SplitViews is a touch affordance, independent of
	// screen size (on a wide screen the container simply does not overflow, so this is inert).
	function touchPointer() {
		return touchLike.matches;
	}

	function interactiveTarget(element) {
		return Boolean(
			element.closest(
				[
					".scrollbar",
					"a",
					"button",
					"input",
					"select",
					"textarea",
					"[contenteditable='true']",
					"[role='button']",
					"[role='checkbox']",
					"[role='radio']",
					".monaco-button",
					".action-label",
				].join(","),
			),
		);
	}

	function horizontalPanContainer(target) {
		if (!touchPointer() || !(target instanceof Element)) {
			return null;
		}

		if (interactiveTarget(target)) {
			return null;
		}

		const selector = horizontalPanSelectors.join(",");
		const container = target.closest(selector);
		if (!(container instanceof HTMLElement)) {
			return null;
		}

		if (container.scrollWidth <= container.clientWidth + 1) {
			return null;
		}

		return container;
	}

	function startHorizontalPan(event) {
		if (event.pointerType === "mouse" || event.button !== 0) {
			return;
		}

		const container = horizontalPanContainer(event.target);
		if (!container) {
			return;
		}

		horizontalPan = {
			container,
			dragging: false,
			pointerId: event.pointerId,
			scrollLeft: container.scrollLeft,
			x: event.clientX,
			y: event.clientY,
		};
	}

	function startHorizontalScrollbarDrag(event) {
		if (event.button !== 0 || !(event.target instanceof Element)) {
			return;
		}

		const slider = event.target.closest(
			".composery-keybindings-scrollbar > .slider",
		);
		if (!(slider instanceof HTMLElement)) {
			return;
		}

		const scrollbar = slider.closest(".composery-keybindings-scrollbar");
		const container = scrollbar?.parentElement?.querySelector(
			`:scope > ${keybindingsTableContainerSelector}`,
		);
		if (!(container instanceof HTMLElement) || !(scrollbar instanceof HTMLElement)) {
			return;
		}

		horizontalScrollbarDrag = {
			container,
			pointerId: event.pointerId,
			scrollLeft: container.scrollLeft,
			slider,
			trackWidth: scrollbar.clientWidth,
			sliderWidth: slider.offsetWidth,
			x: event.clientX,
		};
		slider.classList.add("active");
		event.preventDefault();
		event.stopPropagation();
	}

	function updateHorizontalPan(event) {
		if (!horizontalPan || event.pointerId !== horizontalPan.pointerId) {
			return;
		}

		const deltaX = event.clientX - horizontalPan.x;
		const deltaY = event.clientY - horizontalPan.y;
		const absX = Math.abs(deltaX);
		const absY = Math.abs(deltaY);

		if (!horizontalPan.dragging) {
			if (absY > absX && absY > 8) {
				horizontalPan = null;
				return;
			}

			if (absX < 8 || absX <= absY) {
				return;
			}

			horizontalPan.dragging = true;
		}

		const { container } = horizontalPan;
		if (setScrollLeft(container, horizontalPan.scrollLeft - deltaX)) {
			container.dispatchEvent(new Event("scroll"));
		}

		event.preventDefault();
		event.stopPropagation();
	}

	function updateHorizontalScrollbarDrag(event) {
		if (
			!horizontalScrollbarDrag ||
			event.pointerId !== horizontalScrollbarDrag.pointerId
		) {
			return;
		}

		const {
			container,
			scrollLeft,
			sliderWidth,
			trackWidth,
			x,
		} = horizontalScrollbarDrag;
		const maxLeft = maxScrollLeft(container);
		const maxSliderLeft = Math.max(1, trackWidth - sliderWidth);
		const nextScrollLeft = scrollLeft + ((event.clientX - x) / maxSliderLeft) * maxLeft;

		setScrollLeft(container, nextScrollLeft);
		event.preventDefault();
		event.stopPropagation();
	}

	function stopHorizontalPan(event) {
		if (horizontalPan?.pointerId === event.pointerId) {
			horizontalPan = null;
		}
	}

	function stopHorizontalScrollbarDrag(event) {
		if (horizontalScrollbarDrag?.pointerId === event.pointerId) {
			horizontalScrollbarDrag.slider.classList.remove("active");
			horizontalScrollbarDrag = null;
		}
	}

	function handleKeybindingsScroll(event) {
		if (event.target instanceof HTMLElement) {
			updateKeybindingsScrollbar(event.target);
		}
	}

	function enforce() {
		pending = false;
		updateKeybindingsScrollbars();
	}

	function schedule() {
		if (!pending) {
			pending = true;
			window.requestAnimationFrame(enforce);
		}
	}

	new MutationObserver(schedule).observe(document.documentElement, {
		attributes: true,
		childList: true,
		subtree: true,
	});

	document.addEventListener("scroll", handleKeybindingsScroll, true);
	document.addEventListener("pointerdown", startHorizontalScrollbarDrag, true);
	document.addEventListener("pointerdown", startHorizontalPan, true);
	document.addEventListener("pointermove", updateHorizontalScrollbarDrag, {
		capture: true,
		passive: false,
	});
	document.addEventListener("pointermove", updateHorizontalPan, {
		capture: true,
		passive: false,
	});
	document.addEventListener("pointerup", stopHorizontalScrollbarDrag, true);
	document.addEventListener("pointerup", stopHorizontalPan, true);
	document.addEventListener("pointercancel", stopHorizontalScrollbarDrag, true);
	document.addEventListener("pointercancel", stopHorizontalPan, true);
	window.addEventListener("wheel", (event) => {
		releaseBrowserZoomGesture(event);
		handleHorizontalWheel(event);
	}, {
		capture: true,
		passive: false,
	});
	touchLike.addEventListener("change", schedule);

	window.setTimeout(schedule, 500);
	window.setTimeout(schedule, 1500);
})();
