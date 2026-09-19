// Pinned external versions move only after checking the vendor's published version and digest.
export const ubuntuImage =
	"ubuntu:24.04@sha256:224a1869083a311ef3f13648a154ba79832fbef6364d31493642ca03082da254";

export const ubuntuArchiveSnapshot = "20260915T000000Z";

export const convexBackendVersion = "precompiled-2026-09-11-157eb19";

export const convexBackendAssets: Record<
	string,
	{ name: string; sha256: string }
> = {
	// biome-ignore-start lint/style/useNamingConvention: external platform names
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
	// biome-ignore-end lint/style/useNamingConvention: external platform names
};
