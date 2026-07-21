// The one rule behind every system back on the instance screen, in one place so
// Android's hardware Back and iOS's edge-swipe cannot drift apart. Both are pure
// functions of two facts: whether a live IDE page is on screen, and whether that
// page reports a layer (menu, dialog, full-screen part) open.

export type BackState = {
	// A loaded, error-free IDE page is showing (not the loading veil or an error).
	pageVisible: boolean;
	// The page's latest report that it has a dismissable layer open.
	pageLayerOpen: boolean;
};

export type BackAction = {
	// Inject the page's back handler so it peels its own top layer.
	askPage: boolean;
	// Leave this screen for the instances list.
	leave: boolean;
};

// Hardware Back / the back gesture. A visible page is the authority: it closes
// a layer or posts back when there was nothing to close. pageLayerOpen is only
// a navigation-gesture hint and can be one message stale, so it must never make
// the app leave before the page has actually refused the press.
export function backAction({ pageVisible }: BackState): BackAction {
	if (pageVisible) {
		return { askPage: true, leave: false };
	}
	// No live page to ask (loading or error screen): back just leaves.
	return { askPage: false, leave: true };
}

// iOS has no hardware Back - the screen-edge swipe is the system's back, and it
// pops the screen outright without the page getting the refusal Android's Back
// gives it. So gate the swipe to exactly the presses a hardware Back would let
// leave: keep it off only while the page holds a layer open, so a swipe can never
// pop the screen out from under a menu the user is reading. Tied to backAction so
// the two can't diverge.
export function iosSwipeEnabled(state: BackState): boolean {
	return !state.pageVisible || !state.pageLayerOpen;
}
