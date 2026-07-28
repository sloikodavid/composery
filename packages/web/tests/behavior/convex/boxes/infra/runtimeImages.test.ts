import { describe, expect, test } from "vitest";
import {
	parseImageReference,
	runtimeImageManifestUrl
} from "@/convex/boxes/infra/runtimeImages";

describe("parseImageReference", () => {
	test("defaults a bare name to Docker Hub library/", () => {
		expect(parseImageReference("nginx")).toEqual({
			registry: "docker.io",
			repository: "library/nginx",
			reference: "latest"
		});
	});

	test("defaults a missing tag to latest", () => {
		expect(parseImageReference("user/img")).toEqual({
			registry: "docker.io",
			repository: "user/img",
			reference: "latest"
		});
	});

	test("keeps a namespaced Docker Hub name as-is", () => {
		expect(parseImageReference("user/img:1.27")).toEqual({
			registry: "docker.io",
			repository: "user/img",
			reference: "1.27"
		});
	});

	test("detects a registry host by dot, port, or localhost", () => {
		expect(parseImageReference("ghcr.io/owner/img:tag")).toEqual({
			registry: "ghcr.io",
			repository: "owner/img",
			reference: "tag"
		});
		expect(parseImageReference("registry:5000/team/img:tag")).toEqual({
			registry: "registry:5000",
			repository: "team/img",
			reference: "tag"
		});
		expect(parseImageReference("localhost:5000/img")).toEqual({
			registry: "localhost:5000",
			repository: "img",
			reference: "latest"
		});
	});

	test("treats the last colon as the tag separator, not a host port", () => {
		const parsed = parseImageReference("registry:5000/team/img:1.27");
		expect(parsed.registry).toBe("registry:5000");
		expect(parsed.reference).toBe("1.27");
	});

	test("preserves nested repository paths", () => {
		expect(parseImageReference("ghcr.io/org/team/img:v2")).toEqual({
			registry: "ghcr.io",
			repository: "org/team/img",
			reference: "v2"
		});
	});

	// Everything resolved after creation is a digest reference, so this is the
	// path that matters most. Splitting on the last colon instead would yield the
	// repository "composery@sha256" and the tag "abc" - a perfectly well-formed
	// URL for an image that does not exist, so the failure would be a 404 far from
	// its cause rather than anything that names the real problem.
	test("splits a digest reference on the @, not the last colon", () => {
		expect(
			parseImageReference("ghcr.io/sloikodavid/composery@sha256:abc123")
		).toEqual({
			registry: "ghcr.io",
			repository: "sloikodavid/composery",
			reference: "sha256:abc123"
		});
	});

	test("handles a digest on Docker Hub and on a host with a port", () => {
		expect(parseImageReference("nginx@sha256:def")).toEqual({
			registry: "docker.io",
			repository: "library/nginx",
			reference: "sha256:def"
		});
		expect(parseImageReference("registry:5000/team/img@sha256:def")).toEqual({
			registry: "registry:5000",
			repository: "team/img",
			reference: "sha256:def"
		});
	});

	test("does not add library/ to a non-Docker-Hub registry", () => {
		const parsed = parseImageReference("ghcr.io/nginx");
		expect(parsed.repository).toBe("nginx");
		expect(parsed.registry).toBe("ghcr.io");
	});
});

describe("runtimeImageManifestUrl", () => {
	test("builds a v2 manifest URL without mistaking host ports for tags", () => {
		expect(runtimeImageManifestUrl("registry:5000/team/img:tag")).toBe(
			"https://registry:5000/v2/team/img/manifests/tag"
		);
		expect(runtimeImageManifestUrl("nginx")).toBe(
			"https://registry-1.docker.io/v2/library/nginx/manifests/latest"
		);
	});

	test("addresses a digest reference by its digest", () => {
		expect(
			runtimeImageManifestUrl("ghcr.io/sloikodavid/composery@sha256:abc123")
		).toBe("https://ghcr.io/v2/sloikodavid/composery/manifests/sha256:abc123");
	});

	test("uses Docker Hub's registry API host for Docker Hub references", () => {
		expect(runtimeImageManifestUrl("nginx:1.27")).toBe(
			"https://registry-1.docker.io/v2/library/nginx/manifests/1.27"
		);
		expect(parseImageReference("nginx:1.27").registry).toBe("docker.io");
	});
});
