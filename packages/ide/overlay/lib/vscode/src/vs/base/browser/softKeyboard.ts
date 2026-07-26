/*---------------------------------------------------------------------------------------------
 * Composery: the one answer to "is the soft keyboard up, and how much of the visual viewport
 * does it still cover". Three surfaces have to agree - the workbench layout fit, the keybar
 * that fit drives, and the editor's tap-to-refocus - and no single measurement sees every
 * keyboard, because the three shapes are structurally different:
 *
 *   - Shrinks the VISUAL viewport only (iOS Safari): innerHeight - visualViewport.height is
 *     the keyboard, and the viewport height we lay out to already excludes it.
 *   - Shrinks BOTH viewports in lockstep: our viewport meta is
 *     interactive-widget=resizes-content, so on Chromium the difference above is a structural
 *     zero and no geometry here can see the keyboard at all. shell.js publishes the verdict
 *     from a viewport-height baseline for exactly this case.
 *   - Shrinks neither (Composery Mobile's edge-to-edge WKWebView): the host can only tell us,
 *     by writing the covered height into --composery-touch-keyboard-inset. That property is
 *     the host's channel and nothing in the page may write it, or the measurement is lost;
 *     its 0px default is declared in narrow.css, so a plain browser reads a true zero.
 *
 * `overlap` is what still has to come off the visual viewport. A viewport that already
 * excluded the keyboard needs nothing more, so the two are never both subtracted.
 *--------------------------------------------------------------------------------------------*/

export interface ISoftKeyboard {
	/** Whether a soft keyboard is up at all - the question the keybar and safe-area inset ask. */
	readonly open: boolean;
	/** Pixels of the visual viewport the keyboard covers that the viewport has NOT excluded. */
	readonly overlap: number;
}

function rootProperty(targetWindow: Window, name: string): string {
	return targetWindow.getComputedStyle(targetWindow.document.documentElement).getPropertyValue(name).trim();
}

export function softKeyboard(targetWindow: Window): ISoftKeyboard {
	const viewport = targetWindow.visualViewport;
	// A pinch-zoomed visual viewport is short for reasons that have nothing to do with a
	// keyboard - and iOS honours pinch even under user-scalable=no - so measure at scale 1 only.
	const excluded = viewport && viewport.scale === 1
		? Math.max(0, Math.round(targetWindow.innerHeight - viewport.height - viewport.offsetTop))
		: 0;
	const reported = parseInt(rootProperty(targetWindow, '--composery-touch-keyboard-inset'), 10) || 0;

	return {
		open: rootProperty(targetWindow, '--composery-touch-keyboard-open') === '1' || excluded > 0 || reported > 0,
		overlap: excluded > 0 ? 0 : reported
	};
}
