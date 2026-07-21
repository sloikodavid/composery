import { describe, expect, test, vi } from "vitest";

import {
	fetchServerStamp,
	probeComposery,
	probeUrl,
	versionUrl,
	type ProbeFetch
} from "./probe";

function mockFetch(response: Response | Error): ProbeFetch {
	if (response instanceof Error) {
		return (() => Promise.reject(response)) as ProbeFetch;
	}
	return (() => Promise.resolve(response)) as ProbeFetch;
}

describe("probeUrl", () => {
	test("probe at root with trailing slash", () => {
		expect(probeUrl("https://my-box.composery.cloud/")).toBe(
			"https://my-box.composery.cloud/_composery"
		);
	});

	test("probe at root without trailing slash", () => {
		expect(probeUrl("https://my-box.composery.cloud")).toBe(
			"https://my-box.composery.cloud/_composery"
		);
	});

	test("probe at subpath with trailing slash", () => {
		expect(probeUrl("https://example.com/my-cs/")).toBe(
			"https://example.com/my-cs/_composery"
		);
	});

	test("probe at subpath without trailing slash", () => {
		expect(probeUrl("https://example.com/my-cs")).toBe(
			"https://example.com/my-cs/_composery"
		);
	});

	test("strips query and hash", () => {
		expect(probeUrl("https://my-box.composery.cloud/?folder=/app#editor")).toBe(
			"https://my-box.composery.cloud/_composery"
		);
	});

	test("preserves port", () => {
		expect(probeUrl("http://localhost:8080/")).toBe(
			"http://localhost:8080/_composery"
		);
	});
});

describe("probeComposery", () => {
	test("refuses redirects so another origin cannot borrow the marker", async () => {
		const fetchImpl = vi.fn(() =>
			Promise.resolve(
				new Response('{"composery":true}', {
					status: 200,
					headers: { "content-type": "application/json" }
				})
			)
		) as ProbeFetch;

		await probeComposery("https://example.com/", { fetchImpl });

		expect(fetchImpl).toHaveBeenCalledWith(
			"https://example.com/_composery",
			expect.objectContaining({ redirect: "error" })
		);
	});

	test("refuses to follow a marker redirect", async () => {
		let redirect: RequestRedirect | undefined;
		const fetchImpl: ProbeFetch = (_input, init) => {
			redirect = init?.redirect;
			return Promise.reject(new TypeError("redirect rejected"));
		};
		const result = await probeComposery("https://example.com/", { fetchImpl });
		expect(redirect).toBe("error");
		expect(result).toMatchObject({ ok: false, reason: "unreachable" });
	});

	test("returns ok for composery true response", async () => {
		const fetchImpl = mockFetch(
			new Response('{"composery":true}', {
				status: 200,
				headers: { "content-type": "application/json" }
			})
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
				headers: { "content-type": "text/html" }
			})
		);
		const result = await probeComposery("https://youtube.com/", { fetchImpl });
		expect(result).toEqual({ ok: false, reason: "not-composery" });
	});

	test("returns not-composery for 200 with wrong JSON shape", async () => {
		const fetchImpl = mockFetch(
			new Response('{"name":"youtube"}', {
				status: 200,
				headers: { "content-type": "application/json" }
			})
		);
		const result = await probeComposery("https://youtube.com/", { fetchImpl });
		expect(result).toEqual({ ok: false, reason: "not-composery" });
	});

	test("returns not-composery for 500", async () => {
		const fetchImpl = mockFetch(
			new Response("Internal Error", { status: 500 })
		);
		const result = await probeComposery("https://example.com/", { fetchImpl });
		expect(result).toEqual({ ok: false, reason: "not-composery" });
	});

	test("returns unreachable on network error", async () => {
		const fetchImpl = mockFetch(new Error("Network request failed"));
		const result = await probeComposery("https://example.com/", { fetchImpl });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("unreachable");
			if (result.reason === "unreachable") {
				expect(typeof result.message).toBe("string");
			}
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
			timeoutMs: 50
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe("unreachable");
	});
});

describe("versionUrl", () => {
	test("version at root", () => {
		expect(versionUrl("https://my-box.composery.cloud/")).toBe(
			"https://my-box.composery.cloud/version"
		);
	});

	test("version at subpath, strips query", () => {
		expect(versionUrl("https://example.com/my-cs/?folder=/app")).toBe(
			"https://example.com/my-cs/version"
		);
	});
});

describe("fetchServerStamp", () => {
	test("returns the stamp for a hex commit response", async () => {
		const stamp = "3d4ae873b92e13bd3aeab5591d7d32b375f4f3a3";
		const fetchImpl = mockFetch(new Response(stamp, { status: 200 }));
		expect(await fetchServerStamp("https://example.com/", { fetchImpl })).toBe(
			stamp
		);
	});

	test("returns null when signed out (401)", async () => {
		const fetchImpl = mockFetch(
			new Response('{"error":"Unauthorized"}', { status: 401 })
		);
		expect(
			await fetchServerStamp("https://example.com/", { fetchImpl })
		).toBeNull();
	});

	test("returns null for a non-stamp body (login HTML)", async () => {
		const fetchImpl = mockFetch(
			new Response("<!doctype html>...", { status: 200 })
		);
		expect(
			await fetchServerStamp("https://example.com/", { fetchImpl })
		).toBeNull();
	});

	test("returns null on network error", async () => {
		const fetchImpl = mockFetch(new Error("Network request failed"));
		expect(
			await fetchServerStamp("https://example.com/", { fetchImpl })
		).toBeNull();
	});
});
