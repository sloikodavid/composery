import { describe, expect, test } from "vitest";

import {
	classifyWebViewNavigation,
	isCloudAuthorizationRequest,
	isCloudAuthorizationSuccess
} from "@/lib/webview-navigation";

const instanceUrl = "https://box.example.com/ide/?folder=/workspace";

function classify(requestUrl: string, isTopFrame: boolean | undefined = true) {
	return classifyWebViewNavigation({ instanceUrl, isTopFrame, requestUrl });
}

describe("classifyWebViewNavigation", () => {
	test("keeps the verified Composery mount inside", () => {
		expect(classify("https://box.example.com/ide/")).toBe("inside");
		expect(classify("https://box.example.com/ide/editor?x=1#y")).toBe("inside");
	});

	test("opens every cross-origin top-level navigation externally", () => {
		expect(classify("https://example.org/docs")).toBe("external");
		expect(classify("http://box.example.com/ide/")).toBe("external");
	});

	test("opens same-origin pages outside a subpath mount externally", () => {
		expect(classify("https://box.example.com/admin")).toBe("external");
		expect(classify("https://box.example.com/ide-other")).toBe("external");
		expect(classify("https://box.example.com/proxy/3000/")).toBe("external");
	});

	test("does not rely on navigationType or a present top-frame flag", () => {
		expect(classify("https://example.org/redirect", undefined)).toBe(
			"external"
		);
	});

	test("does not let a custom scheme become the main document", () => {
		expect(classify("mailto:support@example.com")).toBe("external");
		expect(classify("tel:+3531234567")).toBe("external");
		expect(classify("javascript:alert(1)")).toBe("reject");
		expect(classify("data:text/html,not-composery")).toBe("reject");
	});

	test("allows subframes without treating them as the main document", () => {
		expect(classify("https://example.org/embed", false)).toBe("inside");
	});

	test("rejects malformed top-level URLs", () => {
		expect(classify("not a url")).toBe("reject");
	});

	test("allows every path when the verified instance is root-mounted", () => {
		expect(
			classifyWebViewNavigation({
				instanceUrl: "https://box.example.com/",
				isTopFrame: true,
				requestUrl: "https://box.example.com/editor"
			})
		).toBe("inside");
	});
});

describe("cloud authorization navigation", () => {
	const authorization =
		"https://composery.example/boxes/authorize?box_id=box&redirect_uri=" +
		encodeURIComponent("https://box.example.com/ide/_composery/cloud/callback");

	test("recognizes only a cloud request that returns to this instance", () => {
		expect(
			isCloudAuthorizationRequest({
				instanceUrl,
				requestUrl: authorization
			})
		).toBe(true);
		expect(
			isCloudAuthorizationRequest({
				instanceUrl,
				requestUrl: authorization.replace(
					"box.example.com",
					"other.example.com"
				)
			})
		).toBe(false);
		expect(
			isCloudAuthorizationRequest({
				instanceUrl,
				requestUrl: authorization.replace("/boxes/authorize", "/phishing")
			})
		).toBe(false);
	});

	test("closes only after the callback reaches an authenticated box page", () => {
		expect(
			isCloudAuthorizationSuccess({
				instanceUrl,
				requestUrl: "https://box.example.com/ide/"
			})
		).toBe(true);
		expect(
			isCloudAuthorizationSuccess({
				instanceUrl,
				requestUrl: "https://box.example.com/ide/register"
			})
		).toBe(true);
		expect(
			isCloudAuthorizationSuccess({
				instanceUrl,
				requestUrl:
					"https://box.example.com/ide/_composery/cloud/callback?code=x"
			})
		).toBe(false);
		expect(
			isCloudAuthorizationSuccess({
				instanceUrl,
				requestUrl: "https://box.example.com/ide/_composery/cloud/error"
			})
		).toBe(false);
	});
});
