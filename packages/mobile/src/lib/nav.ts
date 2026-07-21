import { type Href, router, useFocusEffect } from "expo-router";
import { useCallback, useRef } from "react";

// Leaving a screen has to land somewhere. A deep link (composery://add-instance,
// composery://instance/:id) opens that screen directly, and with nothing beneath
// it in the stack a plain back() is a no-op — the back button reads as broken and
// Android's hardware back quits the app from a screen the user never navigated
// to. Fall back to the instances list, which is where back was always heading.
export function leaveScreen() {
	if (router.canGoBack()) router.back();
	else router.replace("/");
}

// Navigation away from a screen, at most once per visit.
//
// Every exit here is the tail of something asynchronous — a save that finishes, a
// QR code that decodes, the IDE answering a back press a frame late — and the
// user can have left already by the time it lands. A second navigation then acts
// on whatever screen took this one's place: it pops the instances list, or
// replaces it, and either way the next back press quits the app from a screen
// nobody navigated to. Once the screen is no longer the one on display, its exits
// are no longer its business.
export function useScreenExit() {
	const focused = useRef(true);
	useFocusEffect(
		useCallback(() => {
			focused.current = true;
			return () => {
				focused.current = false;
			};
		}, [])
	);

	const exit = useCallback((go: () => void) => {
		if (!focused.current) return;
		focused.current = false;
		go();
	}, []);

	return {
		/** Back to the previous screen, or the instances list. */
		leave: useCallback(() => exit(leaveScreen), [exit]),
		/** Hand off to another screen, leaving nothing of this one to return to. */
		replaceWith: useCallback(
			(href: Href) => exit(() => router.replace(href)),
			[exit]
		)
	};
}
