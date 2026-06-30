import { afterEach, describe, expect, it } from "vitest";
import ssh2 from "ssh2";
import {
	HetznerApiError,
	type HetznerAction,
	type HetznerImage,
	composeryServerListPath,
	createServerPayload,
	createSnapshotImagePayload,
	isHetznerNotFound,
	parseActionStatus,
	parseCreateImageResponse,
	parseImageResponse,
	parseLocations,
	parseServerTypes,
	placementCandidates,
	primaryIpLookupAddresses,
	primaryIpMatchesAddress,
	primaryIpListPath,
	snapshotImageListPath
} from "./hetznerVps";
import { authorizedPublicKey } from "./sshKeys";

const { utils } = ssh2;

const envNames = [
	"HETZNER_BOX_IMAGE",
	"HETZNER_FIREWALL_ID",
	"HETZNER_NETWORK_ID",
	"HETZNER_SSH_KEY_IDS",
	"SSH_PRIVATE_KEY",
	"SSH_USER"
] as const;
const previousEnv = new Map(envNames.map((name) => [name, process.env[name]]));

afterEach(() => {
	for (const name of envNames) {
		const value = previousEnv.get(name);
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}
});

describe("vps request contracts", () => {
	it("recovers Hetzner servers by immutable Composery labels", () => {
		const path = composeryServerListPath("my-box");
		const query = new URLSearchParams(path.split("?")[1]);

		expect(path.startsWith("/servers?")).toBe(true);
		expect(query.get("label_selector")).toBe(
			"product=composery-web,box_slug=my-box"
		);
	});

	it("creates servers with cloud-init derived from the SSH private key", () => {
		const keyPair = utils.generateKeyPairSync("ed25519", {
			comment: "composery-test"
		});
		process.env.HETZNER_BOX_IMAGE = "ubuntu-24.04";
		process.env.HETZNER_FIREWALL_ID = "42";
		process.env.HETZNER_NETWORK_ID = "";
		process.env.HETZNER_SSH_KEY_IDS = "123,composery-key";
		process.env.SSH_PRIVATE_KEY = keyPair.private.replace(/\n/g, "\\n");
		process.env.SSH_USER = "root";

		const payload = createServerPayload(
			{ serverType: "cx23", location: "nbg1" },
			"my-box"
		);

		expect(payload).toMatchObject({
			image: "ubuntu-24.04",
			name: "composery-my-box",
			ssh_keys: [123, "composery-key"],
			user_data: expect.stringContaining("disable_root: false")
		});
		expect(payload.user_data).toContain(authorizedPublicKey());
	});

	it("looks up orphaned Primary IPs by exact address before deletion", () => {
		const path = primaryIpListPath("203.0.113.10");
		const query = new URLSearchParams(path.split("?")[1]);

		expect(path.startsWith("/primary_ips?")).toBe(true);
		expect(query.get("ip")).toBe("203.0.113.10");
	});

	it("looks up normalized IPv6 Primary IPs with and without Hetzner's /64 suffix", () => {
		expect(primaryIpLookupAddresses("2001:db8::1")).toEqual([
			"2001:db8::1",
			"2001:db8::1/64"
		]);
		expect(primaryIpLookupAddresses("2001:db8::1/64")).toEqual([
			"2001:db8::1/64",
			"2001:db8::1"
		]);

		const path = primaryIpListPath("2001:db8::1/64");
		const query = new URLSearchParams(path.split("?")[1]);
		expect(query.get("ip")).toBe("2001:db8::1/64");
	});

	it("matches IPv6 Primary IPs with or without the network suffix", () => {
		expect(
			primaryIpMatchesAddress(
				{ ip: "2001:db8:85a3::8a2e:370:7334/64" },
				"2001:db8:85a3::8a2e:370:7334"
			)
		).toBe(true);
		expect(
			primaryIpMatchesAddress(
				{ ip: "2001:db8:85a3::8a2e:370:7334" },
				"2001:db8:85a3::8a2e:370:7334/64"
			)
		).toBe(true);
	});
});

describe("placementCandidates", () => {
	it("tries each location for cx23 before falling back to larger types", () => {
		expect(placementCandidates()).toEqual([
			{ serverType: "cx23", location: "nbg1" },
			{ serverType: "cx23", location: "fsn1" },
			{ serverType: "cx23", location: "hel1" },
			{ serverType: "cx33", location: "nbg1" },
			{ serverType: "cx33", location: "fsn1" },
			{ serverType: "cx33", location: "hel1" }
		]);
	});

	it("rejects unsupported env placement values", () => {
		expect(() => parseServerTypes("cx23,ccx13")).toThrow(
			"Unsupported provisioning value"
		);
		expect(() => parseLocations("nbg1,ash")).toThrow(
			"Unsupported provisioning value"
		);
	});
});

describe("snapshot request contracts", () => {
	it("lists a box's snapshot images by the same label selector as servers", () => {
		const path = snapshotImageListPath("my-box");
		const query = new URLSearchParams(path.split("?")[1]);

		expect(path.startsWith("/images?")).toBe(true);
		expect(query.get("type")).toBe("snapshot");
		expect(query.get("label_selector")).toBe(
			"product=composery-web,box_slug=my-box"
		);
	});

	it("builds a create_image payload labeled for the box", () => {
		expect(createSnapshotImagePayload("my-box", "desc")).toEqual({
			type: "snapshot",
			description: "desc",
			labels: { product: "composery-web", box_slug: "my-box" }
		});
	});
});

describe("snapshot response parsing", () => {
	it("extracts the action + image ids from a create_image response", () => {
		expect(
			parseCreateImageResponse({ action: { id: 11 }, image: { id: 22 } })
		).toEqual({ actionId: 11, imageId: 22 });
	});

	it("fails loudly when create_image omits an id", () => {
		expect(() =>
			parseCreateImageResponse({
				action: {} as HetznerAction,
				image: {} as HetznerImage
			})
		).toThrow();
		expect(() =>
			parseCreateImageResponse({ action: { id: 1 }, image: undefined })
		).toThrow();
		expect(() =>
			parseCreateImageResponse({ action: undefined, image: { id: 2 } })
		).toThrow();
	});

	it("maps action status to the poll loop's three branches", () => {
		expect(parseActionStatus({ id: 1, status: "success" })).toEqual({
			status: "success"
		});
		expect(parseActionStatus({ id: 1, status: "running" })).toEqual({
			status: "running"
		});
		// An unknown/transient status is treated as still running, not a failure.
		expect(parseActionStatus({ id: 1, status: "something-new" })).toEqual({
			status: "running"
		});
		expect(parseActionStatus({ id: 1, status: "error" }).status).toBe("error");
		expect(
			parseActionStatus({
				id: 1,
				status: "error",
				error: { message: "disk full" }
			}).error
		).toContain("disk full");
	});

	it("reads image size only once the image is available", () => {
		expect(parseImageResponse({ id: 1, status: "creating" })).toEqual({
			status: "creating"
		});
		expect(
			parseImageResponse({ id: 1, status: "available", image_size: 12.5 })
		).toEqual({ status: "available", imageSizeGb: 12.5 });
		// image_size is null until available; the parser never reports a size then.
		expect(
			parseImageResponse({ id: 1, status: "available", image_size: null })
		).toEqual({ status: "available" });
	});
});

describe("isHetznerNotFound", () => {
	it("matches a 404 HetznerApiError and nothing else", () => {
		expect(isHetznerNotFound(new HetznerApiError("gone", 404))).toBe(true);
		expect(isHetznerNotFound(new HetznerApiError("bad", 400))).toBe(false);
		expect(isHetznerNotFound(new Error("unrelated"))).toBe(false);
	});
});
