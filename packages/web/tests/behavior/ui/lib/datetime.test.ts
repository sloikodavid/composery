import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { formatDate, formatDateTime } from "@/ui/lib/datetime";

// "The current year" is the thing these formatters branch on, so reading it from
// the wall clock made the suite's answer depend on the day it ran - and the one
// day it would have differed is the one nobody runs it on. The clock is pinned
// instead, mid-year so neither boundary is adjacent.
const NOW = new Date("2026-06-04T09:30:00.000Z");

describe("formatDate / formatDateTime", () => {
	beforeAll(() => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
	});
	afterAll(() => {
		vi.useRealTimers();
	});

	test("returns an empty string for missing or zero values", () => {
		expect(formatDate(null)).toBe("");
		expect(formatDate(undefined)).toBe("");
		expect(formatDate(0)).toBe("");
		expect(formatDateTime(null)).toBe("");
		expect(formatDateTime(undefined)).toBe("");
		expect(formatDateTime(0)).toBe("");
	});

	test("formats real timestamps to a non-empty string", () => {
		expect(formatDate(Date.now()).length).toBeGreaterThan(0);
		expect(formatDateTime(new Date().toISOString()).length).toBeGreaterThan(0);
	});

	test("formats numeric and ISO string inputs identically", () => {
		const iso = "2026-06-04T09:30:00.000Z";
		const ms = Date.parse(iso);
		expect(formatDate(iso)).toBe(formatDate(ms));
		expect(formatDateTime(iso)).toBe(formatDateTime(ms));
	});

	test("includes the year only outside the current year", () => {
		const currentYear = new Date().getFullYear();
		const current = new Date(currentYear, 5, 4, 9, 30).getTime();
		const previous = new Date(currentYear - 1, 5, 4, 9, 30).getTime();
		expect(formatDate(current)).not.toContain(String(currentYear));
		expect(formatDateTime(current)).not.toContain(String(currentYear));
		expect(formatDate(previous)).toContain(String(currentYear - 1));
		expect(formatDateTime(previous)).toContain(String(currentYear - 1));
	});

	test("falls back to a string for unparseable input rather than throwing", () => {
		const result = formatDate("not-a-date");
		expect(typeof result).toBe("string");
	});
});
