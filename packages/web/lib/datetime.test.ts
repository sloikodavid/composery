import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "@/lib/datetime";

describe("formatDate / formatDateTime", () => {
	it("returns an empty string for missing or zero values", () => {
		expect(formatDate(null)).toBe("");
		expect(formatDate(undefined)).toBe("");
		expect(formatDate(0)).toBe("");
		expect(formatDateTime(null)).toBe("");
		expect(formatDateTime(undefined)).toBe("");
		expect(formatDateTime(0)).toBe("");
	});

	it("formats real timestamps to a non-empty string", () => {
		expect(formatDate(Date.now()).length).toBeGreaterThan(0);
		expect(formatDateTime(new Date().toISOString()).length).toBeGreaterThan(0);
	});

	it("formats numeric and ISO string inputs identically", () => {
		const iso = "2026-06-04T09:30:00.000Z";
		const ms = Date.parse(iso);
		expect(formatDate(iso)).toBe(formatDate(ms));
		expect(formatDateTime(iso)).toBe(formatDateTime(ms));
	});

	it("falls back to a string for unparseable input rather than throwing", () => {
		const result = formatDate("not-a-date");
		expect(typeof result).toBe("string");
	});
});
