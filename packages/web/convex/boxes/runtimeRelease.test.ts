import { describe, expect, it } from "vitest";
import { floorDeadlinePassed, runtimeStanding } from "./runtimeRelease";

const OLD = "ghcr.io/sloikodavid/composery@sha256:old";
const NEW = "ghcr.io/sloikodavid/composery@sha256:new";

const standing = (over: Parameters<typeof runtimeStanding>[0]) =>
	runtimeStanding(over);

describe("runtimeStanding", () => {
	it("reports an update when the box's digest differs from the fleet's", () => {
		const result = standing({
			boxImage: OLD,
			boxVersion: "0.2.0",
			fleet: { image: NEW, version: "0.2.1" },
			minimum: null
		});

		expect(result.updateAvailable).toBe(true);
		expect(result.currentVersion).toBe("0.2.0");
		expect(result.availableVersion).toBe("0.2.1");
		expect(result.required).toBe(false);
		expect(result.requiredBy).toBe(null);
	});

	it("reports no update when the box is already on the fleet digest", () => {
		expect(
			standing({
				boxImage: NEW,
				boxVersion: "0.2.1",
				fleet: { image: NEW, version: "0.2.1" },
				minimum: null
			}).updateAvailable
		).toBe(false);
	});

	// The version label is decoration. A channel that rebuilds under an unchanged
	// label still ships a different image, and comparing labels would call that
	// "up to date" forever.
	it("compares digests, not version labels", () => {
		expect(
			standing({
				boxImage: OLD,
				boxVersion: "0.2.1",
				fleet: { image: NEW, version: "0.2.1" },
				minimum: null
			}).updateAvailable
		).toBe(true);
	});

	// Unknown must never render as "an update is available": offering an update
	// we cannot describe is worse than waiting for the next refresh.
	it("stays quiet when the fleet release or the box image is unknown", () => {
		expect(
			standing({
				boxImage: OLD,
				boxVersion: null,
				fleet: null,
				minimum: null
			}).updateAvailable
		).toBe(false);
		expect(
			standing({
				boxImage: undefined,
				boxVersion: null,
				fleet: { image: NEW, version: "0.2.1" },
				minimum: null
			}).updateAvailable
		).toBe(false);
	});

	// `updateAvailable: false` means "on the fleet image" and "nothing to compare
	// against" alike. `comparable` is the only thing that separates them, and the
	// interface renders "up to date" off it, so it has to be false wherever either
	// digest is missing.
	it("reports whether the comparison could be made at all", () => {
		const base = { boxVersion: null, minimum: null };
		expect(
			standing({ ...base, boxImage: OLD, fleet: { image: NEW, version: null } })
				.comparable
		).toBe(true);
		expect(standing({ ...base, boxImage: OLD, fleet: null }).comparable).toBe(
			false
		);
		expect(
			standing({
				...base,
				boxImage: undefined,
				fleet: { image: NEW, version: "0.2.1" }
			}).comparable
		).toBe(false);
	});

	it("marks a box below the floor as required, carrying the deadline", () => {
		const result = standing({
			boxImage: OLD,
			boxVersion: "0.2.0",
			fleet: { image: NEW, version: "0.2.1" },
			minimum: { image: NEW, version: "0.2.1", deadline: 5_000 }
		});

		expect(result.required).toBe(true);
		expect(result.requiredBy).toBe(5_000);
	});

	// The floor is raised deliberately and lags the channel, so a box sitting
	// exactly on the floor is compliant even while a newer optional release
	// exists. Conflating the two would force every box onto every release.
	it("treats a box on the floor as compliant even when a newer release exists", () => {
		const result = standing({
			boxImage: OLD,
			boxVersion: "0.2.0",
			fleet: { image: NEW, version: "0.2.1" },
			minimum: { image: OLD, version: "0.2.0", deadline: 5_000 }
		});

		expect(result.required).toBe(false);
		expect(result.requiredBy).toBe(null);
		expect(result.updateAvailable).toBe(true);
	});
});

describe("floorDeadlinePassed", () => {
	const below = standing({
		boxImage: OLD,
		boxVersion: "0.2.0",
		fleet: { image: NEW, version: "0.2.1" },
		minimum: { image: NEW, version: "0.2.1", deadline: 1_000 }
	});

	it("passes only once the deadline is reached", () => {
		expect(floorDeadlinePassed(below, 999)).toBe(false);
		expect(floorDeadlinePassed(below, 1_000)).toBe(true);
		expect(floorDeadlinePassed(below, 1_001)).toBe(true);
	});

	// A floor with no deadline announces itself and never acts, which is what
	// makes naming an image ahead of a date a safe thing to do.
	it("never forces a box when the floor has no deadline", () => {
		const noDeadline = standing({
			boxImage: OLD,
			boxVersion: "0.2.0",
			fleet: { image: NEW, version: "0.2.1" },
			minimum: { image: NEW, version: "0.2.1", deadline: null }
		});

		expect(noDeadline.required).toBe(true);
		expect(floorDeadlinePassed(noDeadline, Number.MAX_SAFE_INTEGER)).toBe(
			false
		);
	});

	it("never forces a box that is already on the floor image", () => {
		const compliant = standing({
			boxImage: NEW,
			boxVersion: "0.2.1",
			fleet: { image: NEW, version: "0.2.1" },
			minimum: { image: NEW, version: "0.2.1", deadline: 1 }
		});

		expect(floorDeadlinePassed(compliant, Number.MAX_SAFE_INTEGER)).toBe(false);
	});
});
