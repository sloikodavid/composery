import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { repoRoot, readRepoFile } from "./support/patchSource.ts";

// Node is pinned in `.nvmrc` for humans and CI, constrained by package engines,
// and baked into the Docker base image for the shipped IDE runtime. Keep those
// declarations in lockstep so the IDE's native-module ABI cannot drift silently.
const nodeVersion = readRepoFile(".nvmrc").trim();
const rootPackage = JSON.parse(readRepoFile("package.json")) as {
	engines?: Record<string, string>;
	packageManager?: string;
};
// Enumerated from disk, not listed: a hardcoded pair silently exempted every
// workflow added after it. Any workflow that sets Node up at all is covered.
const workflows = readdirSync(resolve(repoRoot, ".github/workflows"))
	.filter((name) => name.endsWith(".yml"))
	.map((name) => `.github/workflows/${name}`)
	.filter((path) => readRepoFile(path).includes("actions/setup-node"));

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

	// Rust's version lives in three places and, unlike Node, none of them can see
	// the others: Cargo's rust-version, the CI toolchain action, and the Docker
	// build image. Renovate groups the latter two ("rust toolchain"); this pins
	// Cargo's floor to them, so a bump that misses one fails here.
	test("Rust toolchain pins agree across Cargo, CI, and the Docker image", () => {
		const cargoVersion = /^rust-version = "([^"]+)"$/m.exec(
			readRepoFile("packages/cli/Cargo.toml")
		)?.[1];
		const ciVersion = /^\s+- uses: dtolnay\/rust-toolchain@(\S+)$/m.exec(
			readRepoFile(".github/workflows/ci.yml")
		)?.[1];
		const imageVersion = /^FROM rust:(\d+\.\d+\.\d+)-/m.exec(
			readRepoFile("Dockerfile")
		)?.[1];

		expect(cargoVersion).toBeDefined();
		// Cargo states a minimum (major.minor); CI and the image are exact and must
		// satisfy it, so compare on the major.minor they share.
		const minor = (value?: string) => value?.split(".").slice(0, 2).join(".");
		expect(minor(ciVersion)).toBe(cargoVersion);
		expect(minor(imageVersion)).toBe(cargoVersion);
	});

	test("the workflow scan found something to check", () => {
		// An empty enumeration would make the test.each below vacuously pass.
		expect(workflows.length).toBeGreaterThan(1);
	});

	test.each(workflows)("%s reads Node from .nvmrc, not a literal", (path) => {
		const yaml = readRepoFile(path);
		expect(yaml).toContain("node-version-file: .nvmrc");
		expect(yaml).not.toMatch(/node-version:\s*["']?\d/);
	});
});
