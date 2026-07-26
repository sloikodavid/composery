import { afterEach, describe, expect, it, vi } from "vitest";
import ssh2 from "ssh2";
import {
	HetznerApiError,
	type HetznerAction,
	type HetznerImage,
	composeryServerListPath,
	createServerPayload,
	createSnapshotImagePayload,
	isHetznerNotFound,
	isUnassignedPrimaryIp,
	parseActionStatus,
	parseCreateImageResponse,
	parseImageResponse,
	parseLocations,
	parseServerTypes,
	placementCandidates,
	primaryIpListPath,
	rebuildServerPayload,
	snapshotImageListPath,
	PARKING_VOLUME_MIN_GB,
	attachVolumePayload,
	createVolumePayload,
	parkingVolumeDevicePath,
	parkingVolumeName,
	parkingVolumeSizeGb,
	productVolumeListPath
} from "./hetznerVps";
import { authorizedPublicKey } from "./sshKeys";

const { utils } = ssh2;

const envNames = [
	"HETZNER_BOX_IMAGE",
	"HETZNER_CLOUD_TOKEN",
	"HETZNER_FIREWALL_ID",
	"HETZNER_NETWORK_ID",
	"HETZNER_SSH_KEYS",
	"SSH_PRIVATE_KEY",
	"SSH_USER"
] as const;
const previousEnv = new Map(envNames.map((name) => [name, process.env[name]]));

afterEach(() => {
	vi.unstubAllGlobals();
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
		process.env.HETZNER_SSH_KEYS = "123,composery-key";
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

	it("sends the current SSH public key when rebuilding any image", () => {
		const keyPair = utils.generateKeyPairSync("ed25519", {
			comment: "composery-test"
		});
		process.env.SSH_PRIVATE_KEY = keyPair.private.replace(/\n/g, "\\n");
		process.env.SSH_USER = "root";

		expect(rebuildServerPayload(123)).toEqual({
			image: 123,
			user_data: expect.stringContaining(authorizedPublicKey())
		});
	});

	// Servers are asked for with `enable_ipv4`/`enable_ipv6` and never with an
	// explicit Primary IP id. That is the form Hetzner marks `auto_delete` and
	// removes with the server, and it is the whole reason box deletion no longer
	// deletes Primary IPs itself. If this ever changed to pass an id, the
	// reconciliation report below would be the only thing left cleaning up after
	// it - so pin the shape that makes the reliance true.
	it("lets Hetzner own the box's Primary IPs rather than naming existing ones", () => {
		const keyPair = utils.generateKeyPairSync("ed25519", {
			comment: "composery-test"
		});
		process.env.HETZNER_BOX_IMAGE = "ubuntu-24.04";
		process.env.HETZNER_FIREWALL_ID = "42";
		process.env.HETZNER_NETWORK_ID = "";
		process.env.HETZNER_SSH_KEYS = "123";
		process.env.SSH_PRIVATE_KEY = keyPair.private.replace(/\n/g, "\\n");
		process.env.SSH_USER = "root";

		expect(
			createServerPayload({ serverType: "cx23", location: "nbg1" }, "my-box")
				.public_net
		).toEqual({ enable_ipv4: true, enable_ipv6: true });
	});

	it("pages the whole Primary IP list rather than querying one address", () => {
		const path = primaryIpListPath(3);
		const query = new URLSearchParams(path.split("?")[1]);

		expect(path.startsWith("/primary_ips?")).toBe(true);
		expect(query.get("page")).toBe("3");
		// No `ip` filter: reconciliation asks "what is attached to nothing",
		// which is a question about the whole project, not about one box.
		expect(query.get("ip")).toBeNull();
	});

	it("counts a Primary IP as unassigned only when Hetzner reports no assignee", () => {
		expect(isUnassignedPrimaryIp({ assignee_id: null })).toBe(true);
		expect(isUnassignedPrimaryIp({})).toBe(true);
		// The one that must not be reported: an IP doing its job on a live box.
		expect(isUnassignedPrimaryIp({ assignee_id: 154362612 })).toBe(false);
		// 0 is not a server id Hetzner issues, but it is falsy - so a truthiness
		// check here would report a live IP as a leak.
		expect(isUnassignedPrimaryIp({ assignee_id: 0 })).toBe(false);
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

describe("parking volumes", () => {
	it("sizes from actual used bytes with headroom, never below the Hetzner minimum", () => {
		// A tiny box still gets at least the 10 GB minimum.
		expect(parkingVolumeSizeGb(0)).toBe(PARKING_VOLUME_MIN_GB);
		expect(parkingVolumeSizeGb(1_000_000)).toBe(PARKING_VOLUME_MIN_GB);
		// A large box gets used * 1.2, rounded up to whole GB, plus 3 GB slack:
		// 30 GB -> 36 GB -> +3 = 39.
		expect(parkingVolumeSizeGb(30 * 1e9)).toBe(39);
		// Headroom always rounds the volume up, never down, so the copy cannot just
		// barely overflow.
		expect(parkingVolumeSizeGb(10 * 1e9)).toBeGreaterThan(10);
	});

	it("refuses to size a volume from an unmeasured usage", () => {
		expect(() => parkingVolumeSizeGb(Number.NaN)).toThrow();
		expect(() => parkingVolumeSizeGb(-1)).toThrow();
	});

	it("names and locates a parking volume deterministically from ids", () => {
		expect(parkingVolumeName("my-box")).toBe("composery-park-my-box");
		// The stable by-id path is what lets the box scripts mount the volume
		// without guessing a shifting /dev/sd* letter.
		expect(parkingVolumeDevicePath(1234)).toBe(
			"/dev/disk/by-id/scsi-0HC_Volume_1234"
		);
	});

	it("creates a pre-formatted, labeled volume in the box's own location", () => {
		expect(createVolumePayload("my-box", "nbg1", 12)).toEqual({
			name: "composery-park-my-box",
			size: 12,
			location: "nbg1",
			format: "ext4",
			automount: false,
			labels: { product: "composery-web", box_slug: "my-box", role: "parking" }
		});
	});

	it("attaches without automounting so the box mounts it deliberately", () => {
		expect(attachVolumePayload(42)).toEqual({ server: 42, automount: false });
	});

	it("lists only parking volumes fleet-wide for reconciliation", () => {
		const path = productVolumeListPath(2);
		const query = new URLSearchParams(path.split("?")[1]);
		expect(path.startsWith("/volumes?")).toBe(true);
		expect(query.get("label_selector")).toBe(
			"product=composery-web,role=parking"
		);
		expect(query.get("page")).toBe("2");
	});
});

describe("isHetznerNotFound", () => {
	it("matches a 404 HetznerApiError and nothing else", () => {
		expect(isHetznerNotFound(new HetznerApiError("gone", 404))).toBe(true);
		expect(isHetznerNotFound(new HetznerApiError("bad", 400))).toBe(false);
		expect(isHetznerNotFound(new Error("unrelated"))).toBe(false);
	});
});
