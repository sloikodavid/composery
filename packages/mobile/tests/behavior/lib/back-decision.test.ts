import { describe, expect, test } from "vitest";

import {
	backAction,
	type BackState,
	iosSwipeEnabled
} from "@/lib/back-decision";

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

	// A live page with nothing reported open still owns the decision: the report
	// can be one postMessage stale, so it asks the page and waits for its answer.
	test("a page with nothing reported open is asked before leaving", () => {
		expect(backAction(state(true, false))).toEqual({
			askPage: true,
			leave: false
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

	// The layer report is only a hint. Hardware can ask the page and must not use
	// that hint to leave early; iOS cannot ask during a system swipe, so it uses
	// the hint only to gate whether the gesture may start.
	test("only the iOS gesture uses the layer hint to leave", () => {
		expect(backAction(state(true, false)).leave).toBe(false);
		expect(backAction(state(true, true)).leave).toBe(false);
		expect(iosSwipeEnabled(state(true, false))).toBe(true);
		expect(iosSwipeEnabled(state(true, true))).toBe(false);
	});
});
