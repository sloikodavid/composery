import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const expoRequire = createRequire(require.resolve("expo/package.json"));
const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
const expoVersion = expoRequire("expo/package.json").version;
const prebuildVersion = cliRequire(
	"@expo/prebuild-config/package.json"
).version;
assert.equal(
	prebuildVersion.split(".")[0],
	expoVersion.split(".")[0],
	`Expo ${expoVersion} resolved an incompatible prebuild engine ${prebuildVersion}`
);
const { getPrebuildConfigAsync } = cliRequire("@expo/prebuild-config");
const { compileModsAsync } = cliRequire("@expo/config-plugins");

// Compile from Expo's default base mods, not a developer's existing gitignored
// android/ or ios/ tree. Otherwise yesterday's generated XML can make a broken
// plugin look green until clean CI or EAS rebuilds the app.
const prebuild = await getPrebuildConfigAsync(projectRoot, {
	platforms: ["android", "ios"]
});
await compileModsAsync(prebuild.exp, {
	projectRoot,
	introspect: true,
	platforms: ["android", "ios"],
	assertMissingModProviders: false,
	ignoreExistingNativeFiles: true
});
const config = prebuild.exp;
const mods = config._internal?.modResults;
assert.ok(mods, "Expo introspection did not return native mod results");

const packageJson = JSON.parse(
	await readFile(resolve(projectRoot, "package.json"), "utf8")
);
const eas = JSON.parse(
	await readFile(resolve(projectRoot, "eas.json"), "utf8")
);
assert.equal(config.version, packageJson.version);
assert.equal(eas.cli?.appVersionSource, "remote");
assert.match(eas.cli?.version ?? "", /^\d+\.\d+\.\d+$/);
assert.equal(packageJson.scripts?.eas, "node scripts/eas.mjs");

assert.equal(config.android?.package, "io.composery");
assert.equal(config.ios?.bundleIdentifier, "io.composery");
assert.equal(config.updates?.enabled, false);

const manifest = mods.android?.manifest?.manifest;
assert.ok(manifest, "Expo introspection did not return AndroidManifest.xml");
const permissions = manifest["uses-permission"] ?? [];
// These are the app/prebuild permissions. Android library manifests add
// ACCESS_NETWORK_STATE and AndroidX's package-scoped receiver protection at
// merge time; mobile-preview/mobile-release assert the exact built APK set.
const activePermissions = permissions
	.filter((permission) => permission.$?.["tools:node"] !== "remove")
	.map((permission) => permission.$?.["android:name"])
	.sort();
assert.deepEqual(activePermissions, [
	"android.permission.CAMERA",
	"android.permission.INTERNET",
	"android.permission.VIBRATE"
]);

const removedPermissions = permissions
	.filter((permission) => permission.$?.["tools:node"] === "remove")
	.map((permission) => permission.$?.["android:name"])
	.sort();
assert.deepEqual(removedPermissions, [
	"android.permission.READ_EXTERNAL_STORAGE",
	"android.permission.RECORD_AUDIO",
	"android.permission.SYSTEM_ALERT_WINDOW",
	"android.permission.WRITE_EXTERNAL_STORAGE"
]);

const application = manifest.application?.[0];
assert.equal(application?.$?.["android:allowBackup"], "false");
assert.equal(application?.$?.["android:usesCleartextTraffic"], "true");
const updateEnabled = application?.["meta-data"]?.find(
	(entry) => entry.$?.["android:name"] === "expo.modules.updates.ENABLED"
);
assert.equal(updateEnabled?.$?.["android:value"], "false");

const plist = mods.ios?.infoPlist;
assert.ok(plist, "Expo introspection did not return Info.plist");
assert.equal(
	plist.NSCameraUsageDescription,
	"Allow Composery to use the camera to scan an instance QR code."
);
assert.equal(plist.NSMicrophoneUsageDescription, undefined);
assert.equal(
	plist.NSLocalNetworkUsageDescription,
	"Allow Composery to connect directly to an instance on your local network."
);
assert.deepEqual(plist.NSAppTransportSecurity, {
	NSAllowsArbitraryLoads: false,
	NSAllowsArbitraryLoadsInWebContent: false,
	NSAllowsLocalNetworking: true
});
assert.equal(plist.NSBonjourServices, undefined);
assert.deepEqual(mods.ios?.entitlements ?? {}, {});

console.log(
	"Native config matches the mobile security and permission contract."
);
