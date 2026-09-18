/**
 * Every external version the tests depend on, in one place, so that what a run tests against can
 * be read and moved without hunting. Moving any of these is a deliberate change: a test then runs
 * against a different server, a different backend, or different packages.
 *
 * npm packages are not here. `bun.lock` pins them exactly, and `bun outdated` says what has moved.
 */

/**
 * The Ubuntu that the test SSH server runs. It is the release `HCLOUD_IMAGE` gives a customer's
 * server, so the tests ask the OpenSSH that customers actually have; move it when that one moves.
 * The digest names one build of the image, because the `24.04` tag keeps moving.
 */
export const ubuntuImage =
	"ubuntu:24.04@sha256:224a1869083a311ef3f13648a154ba79832fbef6364d31493642ca03082da254";

/**
 * The day of the Ubuntu package archive that the test server installs from, so its OpenSSH stays
 * the same version. Ubuntu keeps every day, so an old pin gives an old OpenSSH, never a broken
 * build. Move it to test against what people have now.
 */
export const ubuntuArchiveSnapshot = "20260915T000000Z";

/** The Convex backend release that tests run, from Convex's own GitHub releases. */
export const convexBackendVersion = "precompiled-2026-09-11-157eb19";

/** That release's asset and its SHA-256 digest, as GitHub published them, for each platform. */
export const convexBackendAssets: Record<
	string,
	{ name: string; sha256: string }
> = {
	// biome-ignore-start lint/style/useNamingConvention: Node names the platforms and architectures
	"win32-x64": {
		name: "convex-local-backend-x86_64-pc-windows-msvc.zip",
		sha256: "c4c51220c9a0b3dd799150608f54dd5a01370da7f9b94eea50268c2afdc7bc93",
	},
	"linux-x64": {
		name: "convex-local-backend-x86_64-unknown-linux-gnu.zip",
		sha256: "c64b3339f9c4fa97b146741a1ed551b4b2a99dbcbe539ee1063c49069b7b49c4",
	},
	"linux-arm64": {
		name: "convex-local-backend-aarch64-unknown-linux-gnu.zip",
		sha256: "ef3d79aeec748ae8511c5b560ad9c0a43e617111fee803543aecb5d0c98364ae",
	},
	"darwin-x64": {
		name: "convex-local-backend-x86_64-apple-darwin.zip",
		sha256: "83ca7eed58ae269e0daf9d55f2aebbba48db55c16b6341db89db517ffb8e413a",
	},
	"darwin-arm64": {
		name: "convex-local-backend-aarch64-apple-darwin.zip",
		sha256: "a61d352b0501ac6e0e56c25efc2a1e6a2a59a28076ef1168e042317946653641",
	},
	// biome-ignore-end lint/style/useNamingConvention: Node names the platforms and architectures
};
