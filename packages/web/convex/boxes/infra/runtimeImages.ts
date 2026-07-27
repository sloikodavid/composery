import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { requiredEnv } from "../../env";

export type RuntimeRelease = {
	image: string;
	version: string | null;
};

const vRuntimeReleaseResult = v.object({
	image: v.string(),
	version: v.union(v.string(), v.null())
});

export type ParsedImageReference = {
	registry: string;
	repository: string;
	reference: string;
};

// Docker image refs only treat the first segment as a registry if it looks like
// a host; otherwise the ref belongs to Docker Hub.
//
// A digest reference (`repo@sha256:...`) is split on the `@`, not the last
// colon. Getting that wrong is silent rather than loud: `sha256:abc` would parse
// as the tag `abc` on a repository named `repo@sha256`, which is a well-formed
// registry URL for something that does not exist. Every reference this resolves
// after creation is a digest, so that path has to be the correct one.
export function parseImageReference(image: string): ParsedImageReference {
	const slash = image.indexOf("/");
	const firstSegment = slash === -1 ? "" : image.slice(0, slash);
	const hasRegistry =
		slash !== -1 &&
		(firstSegment.includes(".") ||
			firstSegment.includes(":") ||
			firstSegment === "localhost");
	const registry = hasRegistry ? firstSegment : "docker.io";
	const remainder = hasRegistry ? image.slice(slash + 1) : image;

	const at = remainder.lastIndexOf("@");
	const colon = remainder.lastIndexOf(":");
	let reference: string;
	let path: string;
	if (at !== -1) {
		reference = remainder.slice(at + 1);
		path = remainder.slice(0, at);
	} else if (colon === -1) {
		reference = "latest";
		path = remainder;
	} else {
		reference = remainder.slice(colon + 1);
		path = remainder.slice(0, colon);
	}

	const repository =
		registry === "docker.io" && !path.includes("/") ? `library/${path}` : path;

	return { registry, repository, reference };
}

// Docker Hub publishes its registry API on a different host than the name used
// in image references.
function registryHost(registry: string) {
	return registry === "docker.io" ? "registry-1.docker.io" : registry;
}

export function runtimeImageManifestUrl(image: string) {
	const parsed = parseImageReference(image);
	return `https://${registryHost(parsed.registry)}/v2/${parsed.repository}/manifests/${parsed.reference}`;
}

const MANIFEST_ACCEPT =
	"application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json";

// One authenticated session against a repository. Resolving a release takes
// three round trips (index -> platform manifest -> config blob) and a registry
// token is scoped to the repository, not the request, so fetching it once per
// resolve keeps the extra calls cheap and avoids re-authenticating on each 401.
function registryRequests(image: string) {
	const parsed = parseImageReference(image);
	const host = registryHost(parsed.registry);
	let token: string | undefined;

	async function get(path: string, accept: string) {
		const url = `https://${host}/v2/${parsed.repository}/${path}`;
		const headers = () => ({
			Accept: accept,
			...(token ? { Authorization: `Bearer ${token}` } : {})
		});

		let response = await fetch(url, { headers: headers() });
		if (response.status === 401) {
			token = await fetchRegistryToken(
				response.headers.get("www-authenticate")
			);
			response = await fetch(url, { headers: headers() });
		}
		return response;
	}

	return { get, parsed };
}

export const resolveRuntimeImage = internalAction({
	args: {
		image: v.string()
	},
	handler: async (_ctx, args) => {
		return await resolveRuntimeImageValue(args.image);
	}
});

// The digest an arbitrary reference resolves to, plus its version label. Used
// wherever a box's recorded image is set, so the row can name what it runs
// without the interface having to ask a registry per page view.
export const resolveRuntimeRelease = internalAction({
	args: {
		image: v.string()
	},
	returns: vRuntimeReleaseResult,
	handler: async (_ctx, args): Promise<RuntimeRelease> => {
		const image = await resolveRuntimeImageValue(args.image);
		return { image, version: await resolveImageVersion(image) };
	}
});

export const resolveConfiguredRuntimeImage = internalAction({
	args: {},
	handler: async () => {
		return await resolveRuntimeImageValue(requiredEnv("RUNTIME_IMAGE"));
	}
});

async function resolveRuntimeImageValue(image: string) {
	if (image.includes("@sha256:")) return image;
	return await resolveImageDigest(image);
}

async function resolveImageDigest(image: string) {
	const { get, parsed } = registryRequests(image);
	const response = await get(`manifests/${parsed.reference}`, MANIFEST_ACCEPT);

	if (!response.ok) {
		throw new Error(
			`Unable to resolve runtime image digest: ${response.status}.`
		);
	}

	const digest = response.headers.get("Docker-Content-Digest");
	if (!digest) {
		throw new Error("Registry did not return Docker-Content-Digest.");
	}

	return `${parsed.registry}/${parsed.repository}@${digest}`;
}

// The label the Dockerfile stamps with the build's release version. It is what
// turns a digest into something worth showing a person; nothing decides from it.
const VERSION_LABEL = "org.opencontainers.image.version";

// Which platform manifest to read the config from when the reference resolves to
// a multi-platform index. Composery's runtime image is Linux, and the labels we
// read are identical across architectures, so any Linux entry answers - amd64
// first only so repeated resolves of the same index agree.
function pickLinuxManifest(manifests: unknown): string | undefined {
	if (!Array.isArray(manifests)) return undefined;
	const linux = manifests.filter(
		(entry) =>
			typeof entry?.digest === "string" && entry?.platform?.os === "linux"
	);
	const preferred = linux.find(
		(entry) => entry.platform?.architecture === "amd64"
	);
	return (preferred ?? linux[0])?.digest;
}

// The human-readable version of an already-resolved digest, or null when the
// registry will not tell us.
//
// Null is a first-class answer rather than a thrown error: the version is
// decoration on a comparison that is made entirely from digests, so an image
// built without the label, a registry that refuses the blob, or a malformed
// config must degrade to "we know it changed, we cannot name it" instead of
// breaking the update check for the whole fleet.
async function resolveImageVersion(image: string): Promise<string | null> {
	const { get, parsed } = registryRequests(image);

	const manifestResponse = await get(
		`manifests/${parsed.reference}`,
		MANIFEST_ACCEPT
	);
	if (!manifestResponse.ok) return null;
	const manifest = await manifestResponse.json();

	// A multi-platform index has no config of its own; step into one platform's
	// manifest first.
	let config = manifest?.config;
	if (!config) {
		const child = pickLinuxManifest(manifest?.manifests);
		if (!child) return null;
		const childResponse = await get(`manifests/${child}`, MANIFEST_ACCEPT);
		if (!childResponse.ok) return null;
		config = (await childResponse.json())?.config;
	}

	if (typeof config?.digest !== "string") return null;
	const blobResponse = await get(`blobs/${config.digest}`, "*/*");
	if (!blobResponse.ok) return null;

	const version = (await blobResponse.json())?.config?.Labels?.[VERSION_LABEL];
	return typeof version === "string" && version.trim() ? version.trim() : null;
}

// What the deployment's configured channel resolves to right now: an immutable
// digest reference, plus the version label for display. Every "is an update
// available" decision compares the `image` field; `version` never participates,
// so a moving tag that publishes a new build under the same version string is
// still correctly seen as a change.
export const resolveConfiguredRuntimeRelease = internalAction({
	args: {},
	returns: vRuntimeReleaseResult,
	handler: async (): Promise<RuntimeRelease> => {
		const image = await resolveRuntimeImageValue(requiredEnv("RUNTIME_IMAGE"));
		return { image, version: await resolveImageVersion(image) };
	}
});

async function fetchRegistryToken(challenge: string | null) {
	if (!challenge) throw new Error("Registry did not return auth challenge.");

	const params = Object.fromEntries(
		challenge
			.replace(/^Bearer\s+/i, "")
			.split(",")
			.map((part) => {
				const [key, rawValue] = part.split("=");
				return [key, rawValue?.replace(/^"|"$/g, "")];
			})
	);

	if (!params.realm) throw new Error("Registry auth challenge missing realm.");

	const url = new URL(params.realm);
	if (params.service) url.searchParams.set("service", params.service);
	if (params.scope) url.searchParams.set("scope", params.scope);

	const response = await fetch(url);
	const body = (await response.json()) as { token?: string };

	if (!response.ok || !body.token) {
		throw new Error("Unable to fetch registry auth token.");
	}

	return body.token;
}
