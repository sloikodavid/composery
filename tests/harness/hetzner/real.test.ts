import { afterEach, expect, test } from "bun:test";
import { getHetznerToken } from "../../../harness/hetzner/real";

const namesTheToken = /HCLOUD_TOKEN/;
const held = {
	mode: process.env.HCLOUD_MODE,
	token: process.env.HCLOUD_TOKEN,
};

function set(name: "HCLOUD_MODE" | "HCLOUD_TOKEN", value: string | undefined) {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

afterEach(() => {
	set("HCLOUD_MODE", held.mode);
	set("HCLOUD_TOKEN", held.token);
});

test("keeps the fake a fake while the token sits in the file", () => {
	// Credentials alone must not select a real provider project.
	set("HCLOUD_MODE", "fake");
	set("HCLOUD_TOKEN", "not-a-token");

	expect(getHetznerToken()).toBe(null);
});

test("keeps the fake a fake when nothing said which to use", () => {
	set("HCLOUD_MODE", undefined);
	set("HCLOUD_TOKEN", "not-a-token");

	expect(getHetznerToken()).toBe(null);
});

test("refuses a run that asked for the real Hetzner with no token", () => {
	// Never fall back to fake after an explicit real-mode request.
	set("HCLOUD_MODE", "real");
	set("HCLOUD_TOKEN", "");

	expect(() => getHetznerToken()).toThrow(namesTheToken);
});

test("hands a run that asked for it the token it was given", () => {
	set("HCLOUD_MODE", "real");
	set("HCLOUD_TOKEN", "not-a-token");

	expect(getHetznerToken()).toBe("not-a-token");
});
