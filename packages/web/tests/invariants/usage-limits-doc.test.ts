import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
	USAGE_SIGNALS,
	USAGE_STEPS,
	usageStepsPhrase
} from "@/convex/model/box/usage";

// `docs/limits.md` promises a customer that Composery emails them at particular
// percentages of an allowance. What keeps that promise is `USAGE_STEPS`, read by
// `convex/boxes/usage.ts`, and this binds the two.
//
// It is the last rung of the duplication ladder, so it owes a reason the copy
// cannot be removed: the page is markdown and cannot import a constant, and a
// page too vague to name the percentages would not be worth reading - "we will
// warn you at some point" is not a promise. Every surface that *can* derive the
// schedule does. The pricing FAQ and the Terms both build their sentence from
// `usageStepsPhrase`, which is why neither is checked here.
//
// It belongs to this package because this package publishes the page:
// `source.config.ts` points fumadocs at the same `../../docs` this reads, and
// `app/docs/[[...slug]]` is what serves it.
//
// The failure it prevents is quiet, and it only goes one way. Retuning a step
// what the deployment does and leaves the page stating the old schedule; a
// customer told they would hear at the first step, who is then told nothing until
// past it, was told something untrue by a page nobody thinks to re-read.

// The same reach `source.config.ts` makes, from one directory deeper.
const DOC = join(import.meta.dirname, "../../../../docs/limits.md");

// Bold, so this is anchored on the page's deliberate statement of the schedule
// rather than on any percentage that happens to appear in its prose.
const STATED = /\*\*(\d{1,3})%\*\*/g;

describe("the disk and traffic limits page", () => {
	const page = readFileSync(DOC, "utf8");

	// A page this could not read would satisfy every assertion below by containing
	// nothing to contradict.
	test("is there and names both allowances", () => {
		expect(page.length).toBeGreaterThan(500);
		for (const signal of Object.values(USAGE_SIGNALS)) {
			expect(
				page.toLowerCase(),
				`docs/limits.md never names "${signal.label}"`
			).toContain(signal.label.toLowerCase());
		}
	});

	test.each(USAGE_STEPS)("states the %s%% step", (step) => {
		expect(
			page,
			`docs/limits.md does not state **${step}%**, which is a step in USAGE_STEPS. The page promises when a customer is emailed; the constant decides it.`
		).toContain(`**${step}%**`);
	});

	// The other direction, and the one nothing else would notice: a step removed
	// from the code leaves the page promising a warning that no longer comes.
	test("states no percentage that is not a step", () => {
		const stated = [...page.matchAll(STATED)].map((match) => Number(match[1]));
		expect(stated).toHaveLength(USAGE_STEPS.length);
		expect(
			stated.filter(
				(percent) => !(USAGE_STEPS as readonly number[]).includes(percent)
			)
		).toEqual([]);
	});

	// And that the derived surfaces tell the same story as the pinned one.
	test("agrees with the phrase the pricing FAQ and the Terms derive", () => {
		const phrase = usageStepsPhrase();
		for (const step of USAGE_STEPS) expect(phrase).toContain(`${step}%`);
	});
});
