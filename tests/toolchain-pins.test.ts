import { readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";
import { parse } from "yaml";

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
	test("the IDE upstream npm install drops pnpm-only environment config and cleans scratch on failure", () => {
		const source = readRepoFile("packages/ide/scripts/types.mjs");
		expect(source).toContain('process.on("exit", () => rmSync(SCRATCH');
		expect(source).toContain(
			'name.toLowerCase() !== "npm_config_manage_package_manager_versions"'
		);
		expect(source).toContain("{ ...scratch, env: npmEnv }");
	});

	// One product, one version number, and releasing means editing one file.
	//
	// The root package.json is the source: the release workflow reads it, refuses
	// anything that is not plain semver, and derives the git tag, the
	// `:latest`/`:X.Y`/`:X.Y.Z` image tags, and COMPOSERY_BUILD_VERSION - which
	// becomes the image's org.opencontainers.image.version label and everything
	// the update system compares.
	//
	// Every other `version` field in the repository belongs to a private,
	// unpublished workspace package and must stay 0.0.0. That is the point of this
	// test: it does not ask two numbers to agree, it asks that a second real
	// number never appears. Keeping copies in sync is friction paid on every
	// release forever, and a contributor who bumps one and not the other ships a
	// box that reports one version in its editor and another from its own CLI.
	// Nothing here needs a real number - the Rust binary reads the version from
	// the environment at runtime - so the honest state for all of them is "not a
	// version".
	//
	// The mobile app is excluded because it genuinely has its own release train:
	// EAS owns its version remotely (`appVersionSource: "remote"`), and it ships
	// on the app stores' cadence against whatever box it connects to.
	test("only the root package.json carries a real version", () => {
		const productVersion = (
			JSON.parse(readRepoFile("package.json")) as { version: string }
		).version;
		expect(productVersion).toMatch(/^\d+\.\d+\.\d+$/);

		const inert = [
			"packages/web/package.json",
			"packages/ide/package.json",
			"packages/shared/package.json",
			"packages/mobile/package.json"
		];
		for (const path of inert) {
			const version = (JSON.parse(readRepoFile(path)) as { version?: string })
				.version;
			expect(version, path).toBe("0.0.0");
		}

		// The Rust workspace version reaches users through `composery --version`
		// unless the binary overrides it, so this pair has to hold together: the
		// manifest stays inert *and* the override exists.
		expect(
			/^version = "([^"]+)"$/m.exec(
				readRepoFile("packages/cli/Cargo.toml")
			)?.[1]
		).toBe("0.0.0");
		const cli = readRepoFile("packages/cli/crates/composery/src/cli.rs");
		expect(cli).toContain("version = version()");
		expect(cli).toContain('std::env::var("COMPOSERY_BUILD_VERSION")');
	});

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
		const ci = parse(readRepoFile(".github/workflows/ci.yml")) as {
			jobs: Record<string, { steps?: Array<{ uses?: string }> }>;
		};
		const ciVersions = Object.values(ci.jobs)
			.flatMap((job) => job.steps ?? [])
			.flatMap(
				(step) =>
					/^dtolnay\/rust-toolchain@(\S+)$/.exec(step.uses ?? "")?.[1] ?? []
			);
		const imageVersion = /^FROM rust:(\d+\.\d+\.\d+)-/m.exec(
			readRepoFile("Dockerfile")
		)?.[1];

		expect(cargoVersion).toBeDefined();
		expect(ciVersions).toHaveLength(1);
		// Cargo states a minimum (major.minor); CI and the image are exact and must
		// satisfy it, so compare on the major.minor they share.
		const minor = (value?: string) => value?.split(".").slice(0, 2).join(".");
		expect(minor(ciVersions[0])).toBe(cargoVersion);
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
