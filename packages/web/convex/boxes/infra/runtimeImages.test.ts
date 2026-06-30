import { describe, expect, it } from "vitest";
import { parseImageReference, runtimeImageManifestUrl } from "./runtimeImages";

describe("parseImageReference", () => {
	it("defaults a bare name to Docker Hub library/", () => {
		expect(parseImageReference("nginx")).toEqual({
			registry: "docker.io",
			repository: "library/nginx",
			reference: "latest"
		});
	});

	it("defaults a missing tag to latest", () => {
		expect(parseImageReference("user/img")).toEqual({
			registry: "docker.io",
			repository: "user/img",
			reference: "latest"
		});
	});

	it("keeps a namespaced Docker Hub name as-is", () => {
		expect(parseImageReference("user/img:1.27")).toEqual({
			registry: "docker.io",
			repository: "user/img",
			reference: "1.27"
		});
	});

	it("detects a registry host by dot, port, or localhost", () => {
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

	it("treats the last colon as the tag separator, not a host port", () => {
		const parsed = parseImageReference("registry:5000/team/img:1.27");
		expect(parsed.registry).toBe("registry:5000");
		expect(parsed.reference).toBe("1.27");
	});

	it("preserves nested repository paths", () => {
		expect(parseImageReference("ghcr.io/org/team/img:v2")).toEqual({
			registry: "ghcr.io",
			repository: "org/team/img",
			reference: "v2"
		});
	});

	it("does not add library/ to a non-Docker-Hub registry", () => {
		const parsed = parseImageReference("ghcr.io/nginx");
		expect(parsed.repository).toBe("nginx");
		expect(parsed.registry).toBe("ghcr.io");
	});
});

describe("runtimeImageManifestUrl", () => {
	it("builds a v2 manifest URL without mistaking host ports for tags", () => {
		expect(runtimeImageManifestUrl("registry:5000/team/img:tag")).toBe(
			"https://registry:5000/v2/team/img/manifests/tag"
		);
		expect(runtimeImageManifestUrl("nginx")).toBe(
			"https://registry-1.docker.io/v2/library/nginx/manifests/latest"
		);
	});

	it("uses Docker Hub's registry API host for Docker Hub references", () => {
		expect(runtimeImageManifestUrl("nginx:1.27")).toBe(
			"https://registry-1.docker.io/v2/library/nginx/manifests/1.27"
		);
		expect(parseImageReference("nginx:1.27").registry).toBe("docker.io");
	});
});
