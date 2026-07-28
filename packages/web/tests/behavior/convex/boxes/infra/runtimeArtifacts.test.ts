import { describe, expect, test } from "vitest";
import {
	CADDY_IMAGE,
	renderRuntimeArtifacts
} from "@/convex/boxes/infra/runtimeArtifacts";

describe("runtime artifacts", () => {
	test("renders Caddy, compose, and env with the plan's runtime contract", () => {
		const artifacts = renderRuntimeArtifacts({
			cloudBoxId: "box_123",
			cloudOrigin: "https://www.composery.io",
			domain: "my-box.composery.cloud",
			runtimeAuthHash: "$argon2id$v=19$m=1,t=1,p=1$salt$hash",
			runtimeImage: "ghcr.io/sloikodavid/composery@sha256:abc",
			runtimePort: 8080
		});

		expect(artifacts.caddyfile).toContain("my-box.composery.cloud");
		expect(artifacts.caddyfile).toContain("reverse_proxy composery:8080");
		expect(artifacts.compose).toContain(`image: ${CADDY_IMAGE}`);
		expect(artifacts.compose).toContain(
			"ghcr.io/sloikodavid/composery@sha256:abc"
		);
		expect(artifacts.compose).toContain("env_file: ./composery.env");
		expect(artifacts.compose).toContain("COMPOSERY_INIT=systemd");
		expect(artifacts.compose).toContain("PORT=8080");
		expect(artifacts.compose).toContain("privileged: true");
		expect(artifacts.compose).toContain("cgroup: host");
		expect(artifacts.compose).toContain("stop_signal: SIGRTMIN+3");
		expect(artifacts.compose).not.toContain("/etc/composery");
		expect(artifacts.compose).toContain("/sys/fs/cgroup:/sys/fs/cgroup:rw");
		expect(artifacts.compose).toContain("composery_data:/data");
		expect(artifacts.compose).toContain("name: composery_data");
		expect(artifacts.compose).toContain("name: caddy_data");
		expect(artifacts.env).not.toContain("COMPOSERY_INIT");
		expect(artifacts.env).not.toContain("container=docker");
		expect(artifacts.env).not.toContain("PORT");
		expect(artifacts.env).toContain(
			"COMPOSERY_HASHED_PASSWORD='$argon2id$v=19$m=1,t=1,p=1$salt$hash'"
		);
		expect(artifacts.env).toContain("COMPOSERY_CLOUD_BOX_ID='box_123'");
		expect(artifacts.env).toContain(
			"COMPOSERY_CLOUD_ORIGIN='https://www.composery.io'"
		);
	});

	test("renders a locked cloud runtime without a bootstrap password", () => {
		const artifacts = renderRuntimeArtifacts({
			cloudBoxId: "box_123",
			cloudOrigin: "https://www.composery.io",
			domain: "my-box.composery.cloud",
			runtimeImage: "ghcr.io/sloikodavid/composery@sha256:abc",
			runtimePort: 8080
		});

		expect(artifacts.env).not.toContain("HASHED_PASSWORD");
		expect(artifacts.env).toContain("COMPOSERY_CLOUD_BOX_ID='box_123'");
	});
});
