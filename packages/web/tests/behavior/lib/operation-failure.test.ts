import { describe, expect, test } from "vitest";
import { vBoxOperationType, type BoxOperationType } from "@/convex/schema";
import { failureNotice } from "@/lib/operation-failure";

const TYPES = vBoxOperationType.members.map(
	(member) => member.value
) as BoxOperationType[];

describe("failureNotice", () => {
	test("says nothing when the last operation did not fail", () => {
		expect(failureNotice(null, "owner")).toBeNull();
	});

	// The whole point: before this, only repair and update explained a failure, and
	// every other operation left the owner with a status word and no reason
	// anywhere in the interface.
	test.each(TYPES)("has an answer for a failed %s", (type) => {
		const notice = failureNotice(
			{ error: "boom", finishedAt: 1, type },
			"staff"
		);
		expect(notice).not.toBeNull();
		expect(notice?.title.length).toBeGreaterThan(0);
		expect(notice?.detail).toBe("boom");
	});

	// An error with no recorded reason must say so rather than render an empty
	// line, which reads as "nothing wrong here" - the failure mode this whole
	// change is about.
	test("says when no reason was recorded", () => {
		expect(
			failureNotice({ error: null, finishedAt: 1, type: "reset" }, "owner")
				?.detail
		).toBe("No reason was recorded.");
	});

	// Failures an owner cannot act on stay in the console. A scheduled snapshot
	// hitting a fleet-wide Hetzner limit is not something a box owner can fix, and
	// telling them their box failed something would be alarming and useless.
	test.each(["snapshot", "suspend", "unsuspend"] as BoxOperationType[])(
		"hides a failed %s from the owner but not from staff",
		(type) => {
			expect(
				failureNotice({ error: "x", finishedAt: 1, type }, "owner")
			).toBeNull();
			expect(
				failureNotice({ error: "x", finishedAt: 1, type }, "staff")
			).not.toBeNull();
		}
	);

	// The ones an owner is expected to act on carry the action. Without this the
	// notice states a problem and stops, which is the shape of an error message
	// nobody can use.
	test.each([
		"create",
		"reset",
		"restore",
		"repair",
		"update",
		"change_slug",
		"change_config"
	] as BoxOperationType[])(
		"tells the owner what to do about a failed %s",
		(type) => {
			expect(
				failureNotice({ error: "x", finishedAt: 1, type }, "owner")?.hint
			).toBeTruthy();
		}
	);
});
