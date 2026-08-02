// What a box has spent of what its plan includes, and the words for it.
//
// Vocabulary and arithmetic only - no query, no validator, no chart. It is the
// third thing a box's telemetry can be, and the two that already existed had no
// room for it: `metric.ts` names *rates* (bytes per second, packets per second),
// and the flag thresholds built on them catch a box behaving badly right
// now. Neither can answer "how full is the disk" or "how much of this month's
// traffic is left", because those are levels measured against a limit rather
// than rates measured against each other.
//
// The distinction decides everything downstream. A rate is sampled, drawn and
// forgotten; a level is compared to an allowance, told to its owner once when it
// crosses, and never told again until it crosses again.

import { BOX_PLANS, type BoxPlan } from "./plan";

// The two things a box can run out of. Declaration order is the order the box
// page lays the meters out in.
export const USAGE_SIGNALS = {
	disk: {
		label: "Disk",
		// The sentence the notice and the meter's caption are built from. It says
		// what filling it costs the owner, because "80% used" on its own is a number
		// nobody acts on.
		consequence:
			"A full disk stops the box writing anything - files, snapshots and the editor's own state.",
		// What an owner does about it. Never "contact support" where they have a
		// lever of their own.
		remedy:
			"Delete what you do not need, and prune Docker images and build cache from a terminal in the box."
	},
	traffic: {
		label: "Outbound traffic",
		consequence:
			"Traffic past the monthly allowance is not cut off, but sustained excess is charged on or the box is suspended.",
		remedy:
			"Check what is serving or sending from the box, and get in touch if you need a larger allowance."
	}
} as const;

export type UsageSignal = keyof typeof USAGE_SIGNALS;

export const USAGE_SIGNAL_NAMES = Object.keys(USAGE_SIGNALS) as UsageSignal[];

// The percentages at which an owner is told, highest last.
//
// Two, not a slider: the first is early enough to act on and the second is the
// one that says the allowance is effectively gone. A third step would train an
// owner to ignore all of them, which is the same argument `notice/owner.ts`
// makes for keeping its own list short.
export const USAGE_STEPS = [80, 95] as const;

export type UsageStep = (typeof USAGE_STEPS)[number];

// The highest step this percentage has reached, or null below the first.
//
// One rule, read by the sweep that decides whether to send a notice, by the
// card that colours a meter, and by the tests. It used to be two: the Repair
// dialog carried its own 75/90 disk bands, which meant the colour an owner saw
// and the level they were emailed about were different questions with different
// answers.
export function usageStepReached(percent: number | null): UsageStep | null {
	if (percent === null || !Number.isFinite(percent)) return null;
	let reached: UsageStep | null = null;
	for (const step of USAGE_STEPS) {
		if (percent >= step) reached = step;
	}
	return reached;
}

// "80% and again at 95%" - the steps as a fragment of a sentence.
//
// Every reader-facing surface that promises a warning schedule builds its
// sentence from this: the pricing FAQ and the Terms are prose about a rule that
// lives in code, and a percentage typed into either is a promise nothing keeps.
// The documentation is markdown and cannot import it, so that one copy is pinned
// by `tests/invariants/docs-usage-steps.test.ts` instead.
export function usageStepsPhrase() {
	return USAGE_STEPS.map((step) => `${step}%`).join(" and again at ");
}

// The last step, and so the one that means the allowance is effectively gone.
// Read off the list rather than written as 95, so adding a step cannot leave a
// reader pointing at the middle of it.
export const USAGE_FULL_STEP = USAGE_STEPS[USAGE_STEPS.length - 1];

// A share of an allowance as a whole percentage, clamped at the top.
//
// Clamped because both allowances can be exceeded - Hetzner keeps carrying
// traffic past the included amount, and a disk can report 100% while the box
// keeps trying to write - and a meter that draws past its own end says nothing
// the number beside it does not already say. An allowance of zero has no
// percentage rather than an infinite one.
export function usagePercent(used: number, allowance: number): number | null {
	if (!Number.isFinite(used) || !Number.isFinite(allowance)) return null;
	if (allowance <= 0 || used < 0) return null;
	return Math.min(100, Math.round((used / allowance) * 100));
}

const TERABYTE = 1_000 ** 4;
const BYTE_UNITS = ["B", "kB", "MB", "GB", "TB", "PB"] as const;

// Bytes as words, in the decimal units every provider bills in - Hetzner quotes
// a 20 TB allowance meaning 20 x 1000^4, not 20 x 1024^4, and quoting the other
// one would under-report an owner's own usage against their own allowance.
//
// The locale is pinned for the reason `formatFlagValue` pins its own: this
// string reaches an email and a stored notice, so CI and a developer machine
// have to produce the same one.
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
	let value = bytes;
	let unit = 0;
	while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
		value /= 1000;
		unit += 1;
	}
	// Whole bytes have no fraction to show; everything else keeps one decimal, so
	// "1.4 TB" and "980.2 GB" read at the same precision.
	const decimals = unit === 0 ? 0 : 1;
	return `${value.toLocaleString("en-US", {
		maximumFractionDigits: decimals,
		minimumFractionDigits: decimals
	})} ${BYTE_UNITS[unit]}`;
}

// What one plan includes, in bytes, from the plan table's own figure. Nothing
// else converts a plan's terabytes: a second `* 1000 ** 4` somewhere is how the
// allowance an owner is measured against stops being the one they were sold.
export function planTrafficAllowanceBytes(plan: BoxPlan): number {
	return BOX_PLANS[plan].trafficTb * TERABYTE;
}

export function planDiskBytes(plan: BoxPlan): number {
	return BOX_PLANS[plan].diskGb * 1_000 ** 3;
}

// "20 TB outbound traffic each month" - the pricing card's line and the docs'
// figure from one function, so a plan whose allowance changes cannot keep
// advertising the old one.
export function boxPlanTrafficLabel(plan: BoxPlan): string {
	return `${BOX_PLANS[plan].trafficTb} TB outbound traffic each month`;
}
