import { afterEach, expect, test } from "bun:test";
import { getHetznerToken } from "../../../harness/hetzner/real";

const namesTheToken = /HCLOUD_TOKEN/;
const held = { hetzner: process.env.HETZNER, token: process.env.HCLOUD_TOKEN };

function set(name: "HETZNER" | "HCLOUD_TOKEN", value: string | undefined) {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

afterEach(() => {
	set("HETZNER", held.hetzner);
	set("HCLOUD_TOKEN", held.token);
});

test("keeps the fake a fake while the token sits in the file", () => {
	// The token being there is not an instruction to spend money: a plain run stays a fake run.
	set("HETZNER", "fake");
	set("HCLOUD_TOKEN", "not-a-token");

	expect(getHetznerToken()).toBe(null);
});

test("keeps the fake a fake when nothing said which to use", () => {
	set("HETZNER", undefined);
	set("HCLOUD_TOKEN", "not-a-token");

	expect(getHetznerToken()).toBe(null);
});

test("refuses a run that asked for the real Hetzner with no token", () => {
	// Falling back would report success in the same words as a run that met the provider.
	set("HETZNER", "real");
	set("HCLOUD_TOKEN", "");

	expect(() => getHetznerToken()).toThrow(namesTheToken);
});

test("hands a run that asked for it the token it was given", () => {
	set("HETZNER", "real");
	set("HCLOUD_TOKEN", "not-a-token");

	expect(getHetznerToken()).toBe("not-a-token");
});
