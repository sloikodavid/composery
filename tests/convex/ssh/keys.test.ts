import { expect, test } from "bun:test";
import type { SshDiscovery } from "../../../convex/ssh/discovery";
import { isDiscoveredSshKeyFile } from "../../../convex/ssh/keys";

const discovery: SshDiscovery = {
	usesPam: false,
	strictModes: true,
	accounts: [
		{
			name: "alice",
			home: "/home/alice",
			shell: "/bin/sh",
			acceptsPublicKeys: true,
			publicKeyAloneSignsIn: true,
			sources: [
				{
					kind: "file",
					path: "/home/alice/.ssh/authorized_keys",
					status: "present",
				},
				{ kind: "file", path: "/home/alice/.ssh/missing", status: "missing" },
				{ kind: "file", path: "/srv/shared.keys", status: "unsafe" },
			],
		},
	],
	unknowns: [],
};

test("allows an edit only for a discovered present authorized-key file", () => {
	expect(
		isDiscoveredSshKeyFile(
			discovery,
			"alice",
			"/home/alice/.ssh/authorized_keys",
		),
	).toBe(true);
	expect(isDiscoveredSshKeyFile(discovery, "alice", "/etc/passwd")).toBe(false);
	expect(
		isDiscoveredSshKeyFile(
			discovery,
			"bob",
			"/home/alice/.ssh/authorized_keys",
		),
	).toBe(false);
});

test("does not treat missing or unsafe sources as editable", () => {
	expect(
		isDiscoveredSshKeyFile(discovery, "alice", "/home/alice/.ssh/missing"),
	).toBe(false);
	expect(isDiscoveredSshKeyFile(discovery, null, "/srv/shared.keys")).toBe(
		false,
	);
});
