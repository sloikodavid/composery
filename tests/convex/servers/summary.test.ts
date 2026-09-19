import { expect, test } from "bun:test";
import { toServerFeatures } from "../../../convex/servers/summary";

// Part failures are independent: management access must not block power or deletion.

const working = {
	server: "ok",
	addresses: "ok",
	firewall: "ok",
	managementAccess: "ok",
} as const;

test("a server with nothing wrong can be used for everything", () => {
	expect(toServerFeatures(working)).toEqual({
		power: { status: "available" },
		sshKeys: { status: "available" },
		deletion: { status: "available" },
	});
});

test("what Composery cannot get into can still be started, stopped and deleted", () => {
	for (const managementAccess of ["missing", "mismatch"] as const) {
		const features = toServerFeatures({ ...working, managementAccess });
		expect(features.power).toEqual({ status: "available" });
		expect(features.deletion).toEqual({ status: "available" });
		expect(features.sshKeys).toEqual({
			status: "unavailable",
			because: "managementAccess",
		});
	}
});

test("rules or addresses that are not what we recorded stop nothing", () => {
	const features = toServerFeatures({
		...working,
		firewall: "missing",
		addresses: "mismatch",
	});
	expect(features.power).toEqual({ status: "available" });
	expect(features.sshKeys).toEqual({ status: "available" });
});

test("a server nobody has looked at yet claims nothing", () => {
	const features = toServerFeatures({
		server: "unknown",
		addresses: "unknown",
		firewall: "unknown",
		managementAccess: "unknown",
	});
	expect(features.power).toEqual({ status: "unknown", because: "server" });
	expect(features.sshKeys).toEqual({ status: "unknown", because: "server" });
	expect(features.deletion).toEqual({ status: "available" });
});

test("a server that is gone cannot be powered, and can still be deleted", () => {
	const features = toServerFeatures({ ...working, server: "missing" });
	expect(features.power).toEqual({ status: "unavailable", because: "server" });
	expect(features.sshKeys).toEqual({
		status: "unavailable",
		because: "server",
	});
	expect(features.deletion).toEqual({ status: "available" });
});
