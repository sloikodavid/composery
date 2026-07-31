import { afterEach, describe, expect, test, vi } from "vitest";
import { utils } from "ssh2";
import { authorizedPublicKey, privateKey } from "@/convex/boxes/infra/sshKeys";

// `vi.stubEnv`, never a module-load snapshot of `process.env`. A snapshot taken
// when the file is imported is only correct if this file has the process to
// itself: with file isolation off - which is how mutation testing runs the suite
// - a sibling that also saves and restores `SSH_PRIVATE_KEY` captures whatever
// this one happened to leave set, and then restores it over the top. Two files
// hand-rolling the same save/restore is how a key nobody wrote turns up in a
// third test.
afterEach(() => {
	vi.unstubAllEnvs();
});

describe("ssh key helpers", () => {
	test("derives the authorized public key from SSH_PRIVATE_KEY", () => {
		const keyPair = utils.generateKeyPairSync("ed25519", {
			comment: "composery-test"
		});
		vi.stubEnv("SSH_PRIVATE_KEY", keyPair.private.replace(/\n/g, "\\n"));

		const parsedKey = utils.parseKey(keyPair.private);
		if (parsedKey instanceof Error) throw parsedKey;

		expect(privateKey()).toBe(keyPair.private);
		expect(authorizedPublicKey()).toBe(
			`${parsedKey.type} ${parsedKey.getPublicSSH().toString("base64")} composery-web`
		);
	});
});
