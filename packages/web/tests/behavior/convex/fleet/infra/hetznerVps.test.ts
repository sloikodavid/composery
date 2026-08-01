import ssh2 from "ssh2";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
	HetznerApiError,
	PARKING_VOLUME_MIN_GB,
	attachVolumePayload,
	composeryServerListPath,
	createServerPayload,
	createSnapshotImagePayload,
	createVolumePayload,
	isHetznerNotFound,
	isUnassignedPrimaryIp,
	materializeServer,
	parkingVolumeName,
	parkingVolumeSizeGb,
	parseActionStatus,
	parseCreateImageResponse,
	parseImageResponse,
	parseLocations,
	placementCandidates,
	primaryIpListPath,
	productVolumeListPath,
	rebuildServerPayload,
	snapshotImageListPath
} from "@/convex/fleet/infra/hetznerVps";
import {
	type HetznerAction,
	type HetznerImage,
	type HetznerServer
} from "@/convex/fleet/infra/hetznerContracts";
import { authorizedPublicKey } from "@/convex/fleet/infra/sshKeys";

const { utils } = ssh2;

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

function stubHostEnv() {
	const keyPair = utils.generateKeyPairSync("ed25519", {
		comment: "composery-test"
	});
	vi.stubEnv("HETZNER_BOX_IMAGE", "ubuntu-24.04");
	vi.stubEnv("HETZNER_FIREWALL_ID", "42");
	vi.stubEnv("HETZNER_SSH_KEYS", "123,composery-key");
	vi.stubEnv("SSH_PRIVATE_KEY", keyPair.private.replace(/\n/g, "\\n"));
	vi.stubEnv("SSH_USER", "root");
}

const server = (extra: Partial<HetznerServer> = {}): HetznerServer => ({
	id: 42,
	name: "composery-atlas",
	status: "running",
	created: "2026-08-01T00:00:00Z",
	public_net: {
		ipv4: { ip: "1.2.3.4" },
		ipv6: { ip: "2a01::1/64" }
	},
	server_type: { name: "cx23" },
	location: { name: "nbg1" },
	...extra
});

const action = (extra: Partial<HetznerAction> = {}): HetznerAction => ({
	id: 11,
	status: "running",
	error: null,
	...extra
});

const image = (extra: Partial<HetznerImage> = {}): HetznerImage => ({
	id: 22,
	type: "snapshot",
	status: "creating",
	image_size: null,
	disk_size: 40,
	created: "2026-08-01T00:00:00Z",
	description: "atlas",
	labels: { product: "composery-web" },
	bound_to: null,
	created_from: null,
	...extra
});

describe("server requests", () => {
	test("finds a prior create by immutable labels", () => {
		const query = new URLSearchParams(
			composeryServerListPath("atlas").split("?")[1]
		);
		expect(query.get("label_selector")).toBe(
			"product=composery-web,box_slug=atlas"
		);
	});

	test("creates a server with both addresses and current SSH access", () => {
		stubHostEnv();
		const payload = createServerPayload(
			{ serverType: "cx23", location: "nbg1" },
			"atlas"
		);

		expect(payload).toMatchObject({
			name: "composery-atlas",
			server_type: "cx23",
			location: "nbg1",
			ssh_keys: [123, "composery-key"],
			public_net: { enable_ipv4: true, enable_ipv6: true }
		});
		expect(payload.user_data).toContain(authorizedPublicKey());
	});

	test("sends current SSH access when it rebuilds any image", () => {
		stubHostEnv();
		expect(rebuildServerPayload(123)).toEqual({
			image: 123,
			user_data: expect.stringContaining(authorizedPublicKey())
		});
	});
});

describe("server placement", () => {
	test("changes only the location, never the plan's server type", () => {
		expect(placementCandidates("cx43")).toEqual([
			{ serverType: "cx43", location: "nbg1" },
			{ serverType: "cx43", location: "fsn1" },
			{ serverType: "cx43", location: "hel1" }
		]);
	});

	test("rejects an empty or unsupported explicit placement set", () => {
		expect(() => placementCandidates("cx23", [])).toThrow(
			"No Hetzner placement candidates"
		);
		expect(() => parseLocations("nbg1,mars1")).toThrow(
			"Unsupported provisioning value"
		);
	});
});

describe("materialising a provider server", () => {
	test("uses the current location field and normalises IPv6 for DNS", () => {
		expect(materializeServer(server())).toEqual({
			serverId: 42,
			serverType: "cx23",
			location: "nbg1",
			ipv4: "1.2.3.4",
			ipv6: "2a01::1"
		});
	});

	test("rejects a provider value the product cannot represent", () => {
		expect(() =>
			materializeServer(server({ server_type: { name: "cx99" } }))
		).toThrow("unsupported type or location");
		expect(() =>
			materializeServer(server({ public_net: { ipv4: null, ipv6: null } }))
		).toThrow("missing public IPv4 or IPv6");
	});
});

describe("snapshot values", () => {
	test("labels a capture so reconciliation can find it", () => {
		expect(createSnapshotImagePayload("atlas", "desc")).toEqual({
			type: "snapshot",
			description: "desc",
			labels: { product: "composery-web", box_slug: "atlas" }
		});
		const query = new URLSearchParams(
			snapshotImageListPath("atlas").split("?")[1]
		);
		expect(query.get("label_selector")).toBe(
			"product=composery-web,box_slug=atlas"
		);
	});

	test("maps action and image states to workflow values", () => {
		expect(parseActionStatus(action({ status: "success" }))).toEqual({
			status: "success"
		});
		expect(
			parseActionStatus(
				action({
					status: "error",
					error: { code: "failed", message: "disk full" }
				})
			)
		).toEqual({ status: "error", error: "disk full" });
		expect(parseActionStatus(action({ status: "new-state" }))).toEqual({
			status: "running"
		});
		expect(
			parseImageResponse(image({ status: "available", image_size: 12.5 }))
		).toEqual({ status: "available", imageSizeGb: 12.5 });
	});

	test("rejects a create-image response without both resource ids", () => {
		expect(() => parseCreateImageResponse({})).toThrow(
			"Hetzner create_image did not return an action and image id"
		);
	});
});

describe("parking volumes", () => {
	test("sizes from measured bytes with slack and a provider minimum", () => {
		expect(parkingVolumeSizeGb(0)).toBe(PARKING_VOLUME_MIN_GB);
		expect(parkingVolumeSizeGb(30 * 1e9)).toBe(39);
		expect(() => parkingVolumeSizeGb(Number.NaN)).toThrow();
		expect(() => parkingVolumeSizeGb(-1)).toThrow();
	});

	test("creates a labelled preformatted volume in the server location", () => {
		expect(parkingVolumeName("atlas")).toBe("composery-park-atlas");
		expect(createVolumePayload("atlas", "nbg1", 12)).toMatchObject({
			name: "composery-park-atlas",
			location: "nbg1",
			size: 12,
			format: "ext4",
			automount: false
		});
		expect(attachVolumePayload(42)).toEqual({ server: 42, automount: false });
		const query = new URLSearchParams(productVolumeListPath(2).split("?")[1]);
		expect(query.get("label_selector")).toBe(
			"product=composery-web,role=parking"
		);
	});
});

describe("provider identifiers", () => {
	test("reports only Primary IPs with no assignee", () => {
		expect(isUnassignedPrimaryIp({ assignee_id: null })).toBe(true);
		expect(isUnassignedPrimaryIp({})).toBe(true);
		expect(isUnassignedPrimaryIp({ assignee_id: 42 })).toBe(false);
		const query = new URLSearchParams(primaryIpListPath(3).split("?")[1]);
		expect(query.get("page")).toBe("3");
	});

	test("recognises only a Hetzner 404 as missing", () => {
		expect(isHetznerNotFound(new HetznerApiError("gone", 404))).toBe(true);
		expect(isHetznerNotFound(new HetznerApiError("bad", 400))).toBe(false);
		expect(isHetznerNotFound(new Error("404"))).toBe(false);
	});
});
