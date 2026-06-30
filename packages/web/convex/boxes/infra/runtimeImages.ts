import { v } from "convex/values";
import { internalAction } from "../../_generated/server";
import { requiredEnv } from "../../env";

export type ParsedImageReference = {
	registry: string;
	repository: string;
	reference: string;
};

// Docker image refs only treat the first segment as a registry if it looks like
// a host; otherwise the ref belongs to Docker Hub.
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

	const colon = remainder.lastIndexOf(":");
	const reference = colon === -1 ? "latest" : remainder.slice(colon + 1);
	const path = colon === -1 ? remainder : remainder.slice(0, colon);
	const repository =
		registry === "docker.io" && !path.includes("/") ? `library/${path}` : path;

	return { registry, repository, reference };
}

export function runtimeImageManifestUrl(image: string) {
	const parsed = parseImageReference(image);
	const registryHost =
		parsed.registry === "docker.io" ? "registry-1.docker.io" : parsed.registry;
	return `https://${registryHost}/v2/${parsed.repository}/manifests/${parsed.reference}`;
}

export const resolveRuntimeImage = internalAction({
	args: {
		image: v.string()
	},
	handler: async (_ctx, args) => {
		return await resolveRuntimeImageValue(args.image);
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
	const parsed = parseImageReference(image);
	const manifestUrl = runtimeImageManifestUrl(image);
	const headers = {
		Accept:
			"application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json"
	};
	let response = await fetch(manifestUrl, { headers });

	if (response.status === 401) {
		const token = await fetchRegistryToken(
			response.headers.get("www-authenticate")
		);
		response = await fetch(manifestUrl, {
			headers: {
				...headers,
				Authorization: `Bearer ${token}`
			}
		});
	}

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
