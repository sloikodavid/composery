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

// Hardware Back / the back gesture. The page always gets first refusal; we only
// leave for what it does not claim.
export function backAction({
	pageVisible,
	pageLayerOpen
}: BackState): BackAction {
	if (pageVisible) {
		// The page peels its own layer; leave only when it reports none to peel.
		// A stale "open" costs nothing - the page finds nothing and posts back, and
		// we leave a frame later; a stale "closed" costs one press. Neither strands.
		return { askPage: true, leave: !pageLayerOpen };
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
	return backAction(state).leave;
}
