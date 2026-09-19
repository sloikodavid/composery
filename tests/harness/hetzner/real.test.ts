import { afterEach, expect, test } from "bun:test";
import { getHetznerToken } from "../../../harness/hetzner/real";

const namesTheToken = /HCLOUD_TOKEN/;
const held = {
	token: process.env.HCLOUD_TOKEN,
	real: process.env.COMPOSERY_REAL,
};

function set(
	name: "HCLOUD_TOKEN" | "COMPOSERY_REAL",
	value: string | undefined,
) {
	if (value === undefined) {
		delete process.env[name];
		return;
	}
	process.env[name] = value;
}

afterEach(() => {
	set("HCLOUD_TOKEN", held.token);
	set("COMPOSERY_REAL", held.real);
});

test("keeps the fake a fake when no run asked for anything else", () => {
	set("HCLOUD_TOKEN", undefined);
	set("COMPOSERY_REAL", undefined);

	expect(getHetznerToken()).toBe(null);
});

test("refuses a run that asked to meet Hetzner and was given no token", () => {
	// Without this the run passes in the same words as one that met the provider, and what did not
	// happen is invisible: the whole point of the run is that something real answered.
	set("HCLOUD_TOKEN", "");
	set("COMPOSERY_REAL", "hetzner");

	expect(() => getHetznerToken()).toThrow(namesTheToken);
});

test("hands a real run the token it was given", () => {
	set("HCLOUD_TOKEN", "not-a-token");
	set("COMPOSERY_REAL", "hetzner");

	expect(getHetznerToken()).toBe("not-a-token");
});
