import { describe, expect, test } from "vitest";

import { softKeyboard } from "../../../../../../../../overlay/lib/vscode/src/vs/base/browser/softKeyboard.ts";

function fakeWindow(
	innerHeight: number,
	viewport: { height: number; offsetTop: number; scale: number } | undefined,
	vars: Record<string, string> = {}
): Window {
	return {
		innerHeight,
		visualViewport: viewport,
		document: { documentElement: {} },
		getComputedStyle: () => ({
			getPropertyValue: (name: string) => vars[name] ?? ""
		})
	} as unknown as Window;
}

describe("soft keyboard geometry", () => {
	test("combines browser and native-host keyboard signals without double counting", () => {
		expect(
			softKeyboard(fakeWindow(800, { height: 520, offsetTop: 0, scale: 1 }))
		).toEqual({ open: true, overlap: 0 });
		expect(
			softKeyboard(
				fakeWindow(
					800,
					{ height: 800, offsetTop: 0, scale: 1 },
					{ "--composery-touch-keyboard-inset": "180px" }
				)
			)
		).toEqual({ open: true, overlap: 180 });
		expect(
			softKeyboard(
				fakeWindow(
					800,
					{ height: 520, offsetTop: 0, scale: 1 },
					{ "--composery-touch-keyboard-inset": "180px" }
				)
			)
		).toEqual({ open: true, overlap: 0 });
	});

	test("uses the published verdict when both viewports shrink together", () => {
		const geometry = { height: 520, offsetTop: 0, scale: 1 };

		expect(softKeyboard(fakeWindow(520, geometry))).toEqual({
			open: false,
			overlap: 0
		});
		expect(
			softKeyboard(
				fakeWindow(520, geometry, {
					"--composery-touch-keyboard-open": "1"
				})
			)
		).toEqual({ open: true, overlap: 0 });
	});

	test("rejects viewport movement and pinch zoom as keyboard geometry", () => {
		expect(
			softKeyboard(fakeWindow(800, { height: 800, offsetTop: 120, scale: 1 }))
		).toEqual({ open: false, overlap: 0 });
		expect(
			softKeyboard(fakeWindow(800, { height: 400, offsetTop: 0, scale: 2 }))
		).toEqual({ open: false, overlap: 0 });
		expect(softKeyboard(fakeWindow(800, undefined))).toEqual({
			open: false,
			overlap: 0
		});
	});
});
