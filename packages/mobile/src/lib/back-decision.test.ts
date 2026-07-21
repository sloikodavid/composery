import { describe, expect, test } from "vitest";

import { backAction, type BackState, iosSwipeEnabled } from "./back-decision";

const state = (pageVisible: boolean, pageLayerOpen: boolean): BackState => ({
	pageVisible,
	pageLayerOpen
});

describe("hardware back", () => {
	// A live page with a layer open: the page peels the layer, we stay. This is the
	// case that used to over-close - close the layer AND leave the screen.
	test("a page with a layer open peels it without leaving", () => {
		expect(backAction(state(true, true))).toEqual({
			askPage: true,
			leave: false
		});
	});

	// A live page with nothing open: ask it (it finds nothing), and leave.
	test("a page with nothing open is asked, then we leave", () => {
		expect(backAction(state(true, false))).toEqual({
			askPage: true,
			leave: true
		});
	});

	// Loading veil or error screen: no page to ask, so back just leaves.
	test("no live page means back leaves without asking", () => {
		expect(backAction(state(false, false))).toEqual({
			askPage: false,
			leave: true
		});
		expect(backAction(state(false, true))).toEqual({
			askPage: false,
			leave: true
		});
	});
});

describe("iOS edge-swipe", () => {
	// The swipe is the system's back with no page refusal, so it must be off in
	// exactly the state where a hardware back would NOT leave - a layer open over a
	// live page - or the swipe pops the screen out from under it.
	test("is disabled only while a live page holds a layer open", () => {
		expect(iosSwipeEnabled(state(true, true))).toBe(false);
		expect(iosSwipeEnabled(state(true, false))).toBe(true);
		expect(iosSwipeEnabled(state(false, false))).toBe(true);
		expect(iosSwipeEnabled(state(false, true))).toBe(true);
	});

	// The swipe and the hardware back are one contract: the swipe is enabled exactly
	// when a hardware back in the same state would leave. If these two ever diverge,
	// iOS and Android back stop agreeing.
	test("is enabled exactly when a hardware back would leave", () => {
		for (const pageVisible of [true, false]) {
			for (const pageLayerOpen of [true, false]) {
				const s = state(pageVisible, pageLayerOpen);
				expect(iosSwipeEnabled(s)).toBe(backAction(s).leave);
			}
		}
	});
});
