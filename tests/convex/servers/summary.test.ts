import { expect, test } from "bun:test";
import { toServerFeatures } from "../../../convex/servers/summary";

/**
 * The promise the parts exist for: one part being wrong says which, and stops only what depends on
 * it. Every rule lives in this one function, so this is where it can be held to that promise.
 */

const working = {
	server: "ok",
	addresses: "ok",
	firewall: "ok",
	managementAccess: "ok",
} as const;

test("a server with nothing wrong can be used for everything", () => {
	expect(toServerFeatures(working)).toEqual({
		power: { state: "available" },
		sshKeys: { state: "available" },
		deletion: { state: "available" },
	});
});

test("what Composery cannot get into can still be started, stopped and deleted", () => {
	// Somebody removed our key, or replaced the server's own. Their server is theirs to change,
	// and none of that has anything to do with turning it off.
	for (const managementAccess of ["missing", "mismatch"] as const) {
		const features = toServerFeatures({ ...working, managementAccess });
		expect(features.power).toEqual({ state: "available" });
		expect(features.deletion).toEqual({ state: "available" });
		expect(features.sshKeys).toEqual({
			state: "unavailable",
			because: "managementAccess",
		});
	}
});

test("rules or addresses that are not what we recorded stop nothing", () => {
	// An admin detached the firewall, or an address was deleted at the provider. Both are worth
	// saying and neither stops a power command, which is what one word for everything used to do.
	const features = toServerFeatures({
		...working,
		firewall: "missing",
		addresses: "mismatch",
	});
	expect(features.power).toEqual({ state: "available" });
	expect(features.sshKeys).toEqual({ state: "available" });
});

test("a server nobody has looked at yet claims nothing", () => {
	const features = toServerFeatures({
		server: "unknown",
		addresses: "unknown",
		firewall: "unknown",
		managementAccess: "unknown",
	});
	expect(features.power).toEqual({ state: "unknown", because: "server" });
	// Not knowing whether we can sign in is not the same as knowing we cannot.
	expect(features.sshKeys).toEqual({ state: "unknown", because: "server" });
	expect(features.deletion).toEqual({ state: "available" });
});

test("a server that is gone cannot be powered, and can still be deleted", () => {
	const features = toServerFeatures({ ...working, server: "missing" });
	expect(features.power).toEqual({ state: "unavailable", because: "server" });
	expect(features.sshKeys).toEqual({ state: "unavailable", because: "server" });
	expect(features.deletion).toEqual({ state: "available" });
});
