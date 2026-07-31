import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { readRepoFile } from "../support/repo.ts";

// ---------------------------------------------------------------------------
// The API key store is one file written by Rust and read by TypeScript, and
// both sides say so in a header comment - `keystore.rs` opens with "store path,
// JSON shape, and hex SHA-256 hashing must stay identical both sides", and
// `keystore.ts` repeats it. Neither enforced it.
//
// Each side is thoroughly unit-tested on its own, which is exactly why the
// divergence would be silent: rename a field, move the file, or change the
// prefix on one side and every unit test stays green. The only thing that
// exercised the agreement was tests/system/smoke.mjs, which needs a built image
// and runs nightly - so the first report of a broken `composery api key create`
// would be an operator holding a key the server rejects.
//
// Duplication, and why it cannot be removed: the two are separate programs in
// separate languages compiled by separate toolchains, with no shared type to
// derive from. That is the last rung of the ladder in AGENTS.md, and this is the
// test that earns it.
// ---------------------------------------------------------------------------

const rust = readRepoFile("packages/cli/crates/composery/src/keystore.rs");
const rustPaths = readRepoFile("packages/cli/crates/persistence/src/paths.rs");
const ts = readRepoFile("packages/ide/overlay/src/node/routes/api/keystore.ts");
const tsConfig = readRepoFile(
	"packages/ide/overlay/src/node/routes/api/config.ts"
);

// `pub id: String,` -> "id", in declaration order. Order is not part of the
// contract, but the set is, and reading it this way means a renamed field shows
// up as one added and one removed rather than as nothing.
function rustFields(struct: string): string[] {
	const body = new RegExp(`pub struct ${struct} \\{([^}]*)\\}`).exec(rust)?.[1];
	if (body === undefined) throw new Error(`No struct ${struct} in keystore.rs`);
	return [...body.matchAll(/pub (\w+):/g)].map((match) => match[1] ?? "");
}

function tsFields(name: string): string[] {
	const body = new RegExp(`interface ${name} \\{([^}]*)\\}`).exec(ts)?.[1];
	if (body === undefined)
		throw new Error(`No interface ${name} in keystore.ts`);
	return [...body.matchAll(/^\s*(\w+)\??:/gm)].map((match) => match[1] ?? "");
}

describe("the API key store is the same file on both sides", () => {
	test("the sweep found both sides", () => {
		// Every assertion below compares two parsed lists, and two empty lists are
		// equal. This is what stops a moved file from reading as agreement.
		expect(rustFields("KeyRecord").length).toBeGreaterThan(3);
		expect(tsFields("KeyRecord").length).toBeGreaterThan(3);
	});

	test("the record has the same fields in both languages", () => {
		// serde serialises Rust field names verbatim - no rename attributes here -
		// so these are the JSON keys on the wire.
		expect(rust).not.toContain("#[serde(rename");
		expect([...tsFields("KeyRecord")].sort()).toEqual(
			[...rustFields("KeyRecord")].sort()
		);
	});

	test("the envelope has the same fields in both languages", () => {
		expect([...tsFields("KeyStore")].sort()).toEqual(
			[...rustFields("KeyStore")].sort()
		);
	});

	test("both sides write and expect the same store version", () => {
		// Rust's `Default` writes it; TS falls back to it for a missing file. A
		// mismatch means the reader rejects a store the writer just created.
		//
		// Read out of the `Default` impl rather than matched anywhere in the file:
		// `keystore.rs` also contains `{"version":1,...}` as a test fixture, so a
		// loose match would keep passing after the real default changed.
		const rustDefault =
			/impl Default for KeyStore \{[\s\S]*?version:\s*(\d+)/.exec(rust)?.[1];
		const tsFallback = /\{\s*version:\s*(\d+),\s*keys:\s*\[\]\s*\}/.exec(
			ts
		)?.[1];

		expect(rustDefault).toBe("1");
		expect(tsFallback).toBe(rustDefault);
	});

	test("the secret prefix stays Rust's alone", () => {
		// The prefix is minted by Rust, stored per record, and displayed from that
		// record - authentication is by hash, so nothing on the TS side needs to
		// know the spelling. That is why there is no second copy to pin, and this
		// asserts it stays that way: a hardcoded `composery_` in the server or the
		// extension would be a copy that could drift silently, since a wrong one
		// would only ever affect what a user is shown.
		const prefix = /const KEY_PREFIX: &str = "([^"]+)"/.exec(rust)?.[1];
		expect(prefix).toBe("composery_");

		const consumers = [
			"packages/ide/overlay/src/node/routes/api/auth.ts",
			"packages/ide/overlay/src/node/routes/api/keystore.ts",
			"packages/ide/overlay/lib/vscode/extensions/composery-api/extension.js"
		];
		for (const file of consumers) {
			expect(
				readRepoFile(file),
				`${file} hardcodes the key prefix`
			).not.toContain(prefix ?? "");
		}
	});

	test("both sides hash a secret to the same string", () => {
		// Not "both say sha256" - the actual digest. Rust pins the empty-string
		// hash in its own unit test; this recomputes it here, so the two
		// implementations are compared through a value rather than through prose.
		const rustEmptyHash = /hash_secret\(""\),\s*\n\s*"([^"]+)"/.exec(rust)?.[1];
		const tsFormula = '"sha256:" + crypto.createHash("sha256")';

		expect(ts).toContain(tsFormula);
		expect(rust).toContain('format!("sha256:{}"');
		expect(rustEmptyHash).toBe(
			`sha256:${createHash("sha256").update("").digest("hex")}`
		);
	});

	test("both sides resolve the store to the same path", () => {
		// Same volume root, same two segments under it. `keysPath()` and
		// `keystore_path()` are what a key written by the CLI is read back from.
		expect(rustPaths).toContain('PathBuf::from("/data")');
		expect(rustPaths).toContain(
			'std::env::var("COMPOSERY_DOCKER_VOLUME_PATH")'
		);
		expect(tsConfig).toContain(
			'process.env.COMPOSERY_DOCKER_VOLUME_PATH?.trim() || "/data"'
		);

		expect(rust).toContain('volume_root().join("api").join("keys.json")');
		expect(tsConfig).toContain('path.join(DATA_ROOT, "api", "keys.json")');
	});
});
