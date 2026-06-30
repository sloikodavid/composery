import { afterEach, describe, expect, it } from "vitest";
import { utils } from "ssh2";
import { authorizedPublicKey, privateKey } from "./sshKeys";

const previousPrivateKey = process.env.SSH_PRIVATE_KEY;

afterEach(() => {
	if (previousPrivateKey === undefined) {
		delete process.env.SSH_PRIVATE_KEY;
	} else {
		process.env.SSH_PRIVATE_KEY = previousPrivateKey;
	}
});

describe("ssh key helpers", () => {
	it("derives the authorized public key from SSH_PRIVATE_KEY", () => {
		const keyPair = utils.generateKeyPairSync("ed25519", {
			comment: "composery-test"
		});
		process.env.SSH_PRIVATE_KEY = keyPair.private.replace(/\n/g, "\\n");

		const parsedKey = utils.parseKey(keyPair.private);
		if (parsedKey instanceof Error) throw parsedKey;

		expect(privateKey()).toBe(keyPair.private);
		expect(authorizedPublicKey()).toBe(
			`${parsedKey.type} ${parsedKey.getPublicSSH().toString("base64")} composery-web`
		);
	});
});
