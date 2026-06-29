import { describe, expect, test } from "vitest";

import { probeComposery, probeUrl, type ProbeFetch } from "./probe";

function mockFetch(
	response: Response | Error,
): ProbeFetch {
	if (response instanceof Error) {
		return (() => Promise.reject(response)) as ProbeFetch;
	}
	return (() => Promise.resolve(response)) as ProbeFetch;
}

describe("probeUrl", () => {
	test("probe at root with trailing slash", () => {
		expect(probeUrl("https://my-box.composery.cloud/")).toBe(
			"https://my-box.composery.cloud/__composery",
		);
	});

	test("probe at root without trailing slash", () => {
		expect(probeUrl("https://my-box.composery.cloud")).toBe(
			"https://my-box.composery.cloud/__composery",
		);
	});

	test("probe at subpath with trailing slash", () => {
		expect(probeUrl("https://example.com/my-cs/")).toBe(
			"https://example.com/my-cs/__composery",
		);
	});

	test("probe at subpath without trailing slash", () => {
		expect(probeUrl("https://example.com/my-cs")).toBe(
			"https://example.com/my-cs/__composery",
		);
	});

	test("strips query and hash", () => {
		expect(probeUrl("https://my-box.composery.cloud/?folder=/app#editor")).toBe(
			"https://my-box.composery.cloud/__composery",
		);
	});

	test("preserves port", () => {
		expect(probeUrl("http://localhost:8080/")).toBe(
			"http://localhost:8080/__composery",
		);
	});
});

describe("probeComposery", () => {
	test("returns ok for composery true response", async () => {
		const fetchImpl = mockFetch(
			new Response('{"composery":true}', {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const result = await probeComposery("https://example.com/", { fetchImpl });
		expect(result).toEqual({ ok: true });
	});

	test("returns not-composery for 404", async () => {
		const fetchImpl = mockFetch(new Response("Not Found", { status: 404 }));
		const result = await probeComposery("https://youtube.com/", { fetchImpl });
		expect(result).toEqual({ ok: false, reason: "not-composery" });
	});

	test("returns not-composery for 200 with HTML body", async () => {
		const fetchImpl = mockFetch(
			new Response("<!doctype html><html>...</html>", {
				status: 200,
				headers: { "content-type": "text/html" },
			}),
		);
		const result = await probeComposery("https://youtube.com/", { fetchImpl });
		expect(result).toEqual({ ok: false, reason: "not-composery" });
	});

	test("returns not-composery for 200 with wrong JSON shape", async () => {
		const fetchImpl = mockFetch(
			new Response('{"name":"youtube"}', {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);
		const result = await probeComposery("https://youtube.com/", { fetchImpl });
		expect(result).toEqual({ ok: false, reason: "not-composery" });
	});

	test("returns not-composery for 500", async () => {
		const fetchImpl = mockFetch(new Response("Internal Error", { status: 500 }));
		const result = await probeComposery("https://example.com/", { fetchImpl });
		expect(result).toEqual({ ok: false, reason: "not-composery" });
	});

	test("returns unreachable on network error", async () => {
		const fetchImpl = mockFetch(new Error("Network request failed"));
		const result = await probeComposery("https://example.com/", { fetchImpl });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("unreachable");
			expect(typeof result.message).toBe("string");
		}
	});

	test("returns unreachable on abort/timeout", async () => {
		const fetchImpl: ProbeFetch = () =>
			new Promise((_resolve, reject) => {
				const err = new Error("Aborted");
				err.name = "AbortError";
				reject(err);
			});
		const result = await probeComposery("https://example.com/", {
			fetchImpl,
			timeoutMs: 50,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("unreachable");
	});
});
