// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/components/base/button", () => import("@/tests/support/ui"));
vi.mock("@/components/base/dialog", () => import("@/tests/support/ui"));
vi.mock("@/components/boxes/status-button", () => import("@/tests/support/ui"));

import { BoxStatusAction } from "@/components/boxes/status-action";

afterEach(cleanup);

function actions() {
	return {
		retry: { onClick: vi.fn() },
		start: { onClick: vi.fn() },
		stop: { onConfirm: vi.fn() },
		unsuspend: { onClick: vi.fn() }
	};
}

describe("BoxStatusAction", () => {
	test("requires confirmation before stopping a running box", async () => {
		const bound = actions();
		const user = userEvent.setup();
		render(
			createElement(BoxStatusAction, {
				...bound,
				status: "running"
			})
		);

		await user.click(screen.getByRole("button", { name: "Stop" }));
		expect(bound.stop.onConfirm).not.toHaveBeenCalled();
		await user.click(screen.getAllByRole("button", { name: "Stop" })[1]);
		expect(bound.stop.onConfirm).toHaveBeenCalledWith();
	});

	test("routes stopped, failed, and suspended states to their exact actions", async () => {
		const bound = actions();
		const user = userEvent.setup();
		const view = render(
			createElement(BoxStatusAction, {
				...bound,
				start: { ...bound.start, disabled: true },
				status: "stopped"
			})
		);
		expect(
			(screen.getByRole("button", { name: "Start" }) as HTMLButtonElement)
				.disabled
		).toBe(true);

		view.rerender(
			createElement(BoxStatusAction, {
				...bound,
				status: "create_failed"
			})
		);
		await user.click(screen.getByRole("button", { name: "Create again" }));
		expect(bound.retry.onClick).toHaveBeenCalledWith(
			expect.objectContaining({ type: "click" })
		);

		view.rerender(
			createElement(BoxStatusAction, {
				...bound,
				status: "suspended"
			})
		);
		await user.click(screen.getByRole("button", { name: "Unsuspend" }));
		expect(bound.unsuspend.onClick).toHaveBeenCalledWith(
			expect.objectContaining({ type: "click" })
		);

		view.rerender(
			createElement(BoxStatusAction, {
				retry: bound.retry,
				start: bound.start,
				status: "suspended",
				stop: bound.stop
			})
		);
		expect(
			(screen.getByRole("button", { name: "suspended" }) as HTMLButtonElement)
				.disabled
		).toBe(true);

		view.rerender(
			createElement(BoxStatusAction, {
				...bound,
				status: "repair_failed"
			})
		);
		expect(
			(
				screen.getByRole("button", {
					name: "repair_failed"
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
	});
});
