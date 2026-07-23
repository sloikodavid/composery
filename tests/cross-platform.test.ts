import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { repoRoot, readRepoFile } from "./support/patchSource.ts";

// Composery must be developable on Linux, Windows and macOS alike. `check`
// splits into the portable set (proven on every OS by ci.yml's portable job)
// and the few targets that genuinely cannot leave Linux. The split is only
// worth anything if a newly added check:* target has to pick a side, so these
// tests fail on any target that belongs to neither.
const rootPackage = JSON.parse(readRepoFile("package.json")) as {
	scripts: Record<string, string>;
};
const scripts = rootPackage.scripts;
const ciWorkflow = readRepoFile(".github/workflows/ci.yml");

// Deliberately excluded from the cross-platform matrix:
// - check:cli  cargo builds the persistence crate, which needs inotify/xattr.
// - check:renovate  schema validation has no OS-specific behaviour to repeat.
const PORTABLE_EXCLUSIONS = ["check:cli", "check:renovate"];

// pnpm run targets named inside a script body, e.g. "pnpm check:types && ...".
function targetsOf(script: string): string[] {
	return [...script.matchAll(/pnpm (check:[a-z:-]+)/g)].flatMap(
		(match) => match[1] ?? []
	);
}

const checkTargets = Object.keys(scripts).filter(
	(name) => name.startsWith("check:") && name !== "check:portable"
);
const portableTargets = targetsOf(scripts["check:portable"] ?? "");

describe("cross-platform checks", () => {
	test("formatting excludes Expo's generated native projects", () => {
		const prettierIgnore = readRepoFile(".prettierignore");

		expect(prettierIgnore).toMatch(/^packages\/mobile\/android\/$/m);
		expect(prettierIgnore).toMatch(/^packages\/mobile\/ios\/$/m);
	});

	test("local smoke builds have no arbitrary wall-clock cutoff", () => {
		const smoke = readRepoFile("scripts/smoke.mjs");

		expect(smoke).toContain(
			"buildTimeoutMs: parseOptionalTimeout(process.env.SMOKE_BUILD_TIMEOUT_MS)"
		);
		expect(smoke).toContain("options.timeoutMs === null");
		expect(smoke).toContain(": (options.timeoutMs ?? 120_000)");
		expect(smoke).not.toContain("45 * 60_000");
	});

	test("native config uses Expo's matching clean prebuild engine", () => {
		const checker = readRepoFile(
			"packages/mobile/scripts/check-native-config.mjs"
		);
		const mobilePackage = JSON.parse(
			readRepoFile("packages/mobile/package.json")
		) as { scripts?: Record<string, string> };

		expect(mobilePackage.scripts?.["check:native-config"]).toBe(
			"node scripts/check-native-config.mjs"
		);
		expect(checker).toContain(
			'createRequire(expoRequire.resolve("@expo/cli/package.json"))'
		);
		expect(checker).toMatch(
			/const prebuildVersion = cliRequire\(\s*"@expo\/prebuild-config\/package\.json"\s*\)\.version/
		);
		expect(checker).toContain("ignoreExistingNativeFiles: true");
	});

	test("the pinned EAS wrapper does not shell-interpret arguments", () => {
		const wrapper = readRepoFile("packages/mobile/scripts/eas.mjs");

		expect(wrapper).toContain("`eas-cli@${version}`");
		expect(wrapper).not.toMatch(/shell\s*:/);
		expect(wrapper).toContain("node_modules/npm/bin/npx-cli.js");
		expect(wrapper).toContain(
			"delete childEnv.npm_config_manage_package_manager_versions"
		);
	});

	test("lint warnings fail every lint scope", () => {
		const packages = [
			"package.json",
			"packages/mobile/package.json",
			"packages/web/package.json"
		];
		for (const path of packages) {
			const pkg = JSON.parse(readRepoFile(path)) as {
				scripts?: Record<string, string>;
			};
			expect(pkg.scripts?.["check:lint"], path).toContain("--max-warnings 0");
		}
	});

	test("every check target is portable or explicitly excluded", () => {
		const unclassified = checkTargets.filter(
			(name) =>
				!portableTargets.includes(name) && !PORTABLE_EXCLUSIONS.includes(name)
		);

		expect(unclassified).toEqual([]);
	});

	test("portable exclusions are named, not merely left out", () => {
		// A target dropped from check:portable without being listed here would
		// otherwise read as "portable set shrank" instead of failing.
		expect(checkTargets).toEqual(
			expect.arrayContaining([...PORTABLE_EXCLUSIONS, ...portableTargets])
		);
		expect(portableTargets.length).toBeGreaterThan(0);
	});

	test("check still runs the portable set and every exclusion", () => {
		const umbrella = targetsOf(scripts.check ?? "");

		expect(umbrella).toContain("check:portable");
		for (const target of PORTABLE_EXCLUSIONS)
			expect(umbrella).toContain(target);
	});

	test("CI proves the portable set on both Windows and macOS", () => {
		// Without a non-Linux runner actually invoking it, check:portable is a
		// label rather than a guarantee.
		expect(ciWorkflow).toContain("pnpm check:portable");
		expect(ciWorkflow).toMatch(/os: \[windows-[\w.-]+, macos-[\w.-]+\]/);
	});

	// A dependency shipping prebuilt binaries for only some platforms makes
	// `pnpm install --frozen-lockfile` unresolvable on the rest - the failure a
	// contributor on Apple Silicon hits first. Rather than exempt the families
	// that legitimately skip an OS (sharp vendors libvips into its win32
	// packages, so it has no win32 libvips build), require both architectures of
	// every OS a family does publish for. No allowlist to rot.
	test("native dependencies cover both architectures of every OS they ship", () => {
		const ARCHES = ["arm64", "x64"];
		const families = new Map<string, Set<string>>();

		for (const line of readRepoFile("pnpm-lock.yaml").split("\n")) {
			if (!/^ {2}\S+@/.test(line)) continue;
			// Lockfile keys are single-quoted when scoped: '@next/swc-darwin-arm64@16.2.6':
			const name = line
				.trim()
				.replace(/^'|':$|:$/g, "")
				.replace(/@[^@]*$/, "");
			const parts = /^(.*?)[@/-](darwin|linux|win32)[-/]?([a-z0-9]*)/.exec(
				name
			);
			if (!parts) continue;
			const family = (parts[1] ?? "").replace(/[@/-]$/, "");
			if (!families.has(family)) families.set(family, new Set());
			families.get(family)?.add(`${parts[2]}-${parts[3] || "?"}`);
		}

		expect(families.size).toBeGreaterThan(0);

		const gaps = [...families]
			.flatMap(([family, variants]) =>
				["darwin", "linux", "win32"]
					.filter((os) => [...variants].some((v) => v.startsWith(`${os}-`)))
					.flatMap((os) =>
						ARCHES.filter(
							(arch) =>
								![...variants].some((v) => v.startsWith(`${os}-${arch}`))
						).map((arch) => `${family} is missing ${os}-${arch}`)
					)
			)
			.sort();

		expect(gaps).toEqual([]);
	});

	test("Maestro flows are not pinned to one platform's app id", () => {
		// Expo Go is host.exp.exponent on Android but host.exp.Exponent on iOS,
		// so a hardcoded appId silently makes a flow Android-only. Taking it as
		// ${APP_ID} is what lets one flow file cover both.
		const flows = readdirSync(resolve(repoRoot, "packages/mobile/src/maestro"))
			.filter((name) => name.endsWith(".yml"))
			.map((name) => ({
				name,
				appId: /^appId:\s*(.+)$/m
					.exec(readRepoFile(`packages/mobile/src/maestro/${name}`))?.[1]
					?.trim()
			}));

		expect(flows.length).toBeGreaterThan(0);
		expect(flows.filter((flow) => flow.appId !== "${APP_ID}")).toEqual([]);
	});

	test("every testID in the app is documented for flow authors", () => {
		// Matches any prop spelling, not just testID=: the instance screen passes
		// one down as backTestID, and a pattern that only knew the common spelling
		// would report a documented id as missing from the source.
		const ids = new Set<string>();
		const walk = (dir: string): void => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const path = resolve(dir, entry.name);
				if (entry.isDirectory()) {
					walk(path);
				} else if (entry.name.endsWith(".tsx")) {
					for (const match of readFileSync(path, "utf8").matchAll(
						/[a-zA-Z]*[tT]estID=["']([^"']+)["']/g
					))
						if (match[1]) ids.add(match[1]);
				}
			}
		};
		walk(resolve(repoRoot, "packages/mobile/src"));

		const testIdSection = readRepoFile(
			"packages/mobile/src/maestro/README.md"
		).match(/## Test IDs\s+([\s\S]*?)(?:\n## |$)/)?.[1];
		expect(testIdSection).toBeDefined();
		const documented = new Set(
			[...(testIdSection ?? "").matchAll(/`([^`]+)`/g)].flatMap(
				(match) => match[1] ?? []
			)
		);

		expect(ids.size).toBeGreaterThan(5);
		expect([...ids].filter((id) => !documented.has(id)).sort()).toEqual([]);
		expect([...documented].filter((id) => !ids.has(id)).sort()).toEqual([]);
	});

	test("mobile e2e drives both an Android emulator and an iOS simulator", () => {
		const workflow = readRepoFile(".github/workflows/mobile-e2e.yml");

		expect(workflow).toContain("android-emulator-runner");
		expect(workflow).toContain("expo run:ios");
		expect(workflow).toMatch(/runs-on: macos-[\w.-]+/);
	});

	test("every Maestro install is the one checksummed pin Renovate can see", () => {
		const installer = readRepoFile(".github/scripts/install-maestro.sh");
		const renovate = readRepoFile("renovate.json");
		const callers = [
			".github/workflows/mobile-e2e.yml",
			".github/workflows/mobile-release.yml"
		];

		expect(installer).toMatch(
			/# renovate: datasource=github-releases depName=mobile-dev-inc\/maestro\nMAESTRO_VERSION=\d+\.\d+\.\d+\n/
		);
		expect(installer).toMatch(/MAESTRO_SHA256=[a-f0-9]{64}\n/);
		expect(installer).toContain(
			"releases/download/cli-$MAESTRO_VERSION/maestro.zip"
		);
		expect(installer).toContain("shasum -a 256 -c -");
		expect(renovate).toContain("install-maestro");

		// A second copy of the pin is what this collapsed: Renovate's custom
		// manager reads one file, so a version living anywhere else is a version
		// that stays behind on the next bump - against a checksum that moved.
		for (const caller of callers) {
			const workflow = readRepoFile(caller);
			expect(workflow, caller).toContain(
				"sh .github/scripts/install-maestro.sh"
			);
			expect(workflow, caller).not.toMatch(/MAESTRO_(VERSION|SHA256)/);
			expect(workflow, caller).not.toContain("get.maestro.mobile.dev");
		}
		expect(
			readRepoFile(callers[0]!).match(
				/sh \.github\/scripts\/install-maestro\.sh/g
			)
		).toHaveLength(2);
	});

	test("the mobile bundle is exported for every platform it ships to", () => {
		// app.json configures ios and android; exporting only one of them lets a
		// bundling error on the other reach a release unseen.
		const mobilePackage = JSON.parse(
			readRepoFile("packages/mobile/package.json")
		) as { scripts: Record<string, string> };

		expect(mobilePackage.scripts.build).toBe("expo export --platform all");
	});
});
