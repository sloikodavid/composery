import { describe, expect, test } from "vitest";

import { readRepoFile } from "./support/patchSource.ts";

// Node is pinned in `.nvmrc` for humans and CI, constrained by package engines,
// and baked into the Docker base image for the shipped IDE runtime. Keep those
// declarations in lockstep so the IDE's native-module ABI cannot drift silently.
const nodeVersion = readRepoFile(".nvmrc").trim();
const rootPackage = JSON.parse(readRepoFile("package.json")) as {
	engines?: Record<string, string>;
	packageManager?: string;
};
const workflows = ["ci", "smoke"].map(
	(name) => `.github/workflows/${name}.yml`
);

describe("toolchain pins", () => {
	test(".nvmrc is exact semver", () => {
		expect(nodeVersion).toMatch(/^\d+\.\d+\.\d+$/);
	});

	test("package engines match the pinned Node version", () => {
		const nodeMajor = Number(nodeVersion.split(".")[0]);

		expect(rootPackage.engines?.node).toBe(
			`>=${nodeVersion} <${nodeMajor + 1}`
		);
		expect(rootPackage.engines).not.toHaveProperty("pnpm");
	});

	test("Dockerfile base image names the exact pinned Node version", () => {
		const dockerImage =
			/^ARG NODE_IMAGE=node:(\d+\.\d+\.\d+)-trixie-slim@sha256:[a-f0-9]{64}$/m.exec(
				readRepoFile("Dockerfile")
			)?.[1];

		expect(dockerImage).toBe(nodeVersion);
	});

	test("Dockerfile runtime pnpm matches packageManager", () => {
		const pnpmVersion = /^pnpm@([^+]+)/.exec(
			rootPackage.packageManager ?? ""
		)?.[1];
		const dockerPnpmVersion = /^ARG PNPM_VERSION=(\S+)$/m.exec(
			readRepoFile("Dockerfile")
		)?.[1];

		expect(dockerPnpmVersion).toBe(pnpmVersion);
	});

	test("IDE engine patch rejects the old upstream Node major", () => {
		const nodeMajor = Number(nodeVersion.split(".")[0]);
		const patch = readRepoFile("packages/ide/patches/node-engine.diff");

		expect(patch).toContain('-    "node": "22"');
		expect(patch).toContain(`+    "node": ">=24.15.0 <${nodeMajor + 1}"`);
	});

	test.each(workflows)("%s reads Node from .nvmrc, not a literal", (path) => {
		const yaml = readRepoFile(path);
		expect(yaml).toContain("node-version-file: .nvmrc");
		expect(yaml).not.toMatch(/node-version:\s*["']?\d/);
	});
});
