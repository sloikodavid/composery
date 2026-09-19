import { hetznerContract } from "../../contracts/hetzner";
import { type Fake, type FakeReply, startFake } from "../fake";
import {
	detachHetznerFirewalls,
	getHetznerToken,
	stopHetznerServer,
	toHetznerForward,
} from "./real";
import {
	toActionReply,
	toFirewallReply,
	toImageReply,
	toPaginationReply,
	toPrimaryIpReply,
	toServerReply,
	toServerTypeReply,
} from "./replies";

/**
 * A fake for Hetzner Cloud. What it knows about Hetzner is only what Composery reads, and every
 * reply is held to Hetzner's own description, so the fake cannot answer in a shape Hetzner never
 * would.
 */

const httpOk = 200;
const httpCreated = 201;
const httpNoContent = 204;
const httpNotFound = 404;
const firstId = 1000;
const addressBytes = 256;
const hexRadix = 16;
const ipv4Offset = 1;
const ipv6Offset = 2;
const controllerFirewallId = 77;
const controllerId = "composery-test";
const imageId = 501;
const serverTypeName = "cx23";
const locations = ["nbg1", "fsn1", "hel1"];
const firstLocation = "nbg1";

type Collection = "servers" | "primary_ips";

type Resource = {
	id: number;
	collection: Collection;
	/** What Composery's own label says this is: `ipv4`, `ipv6`, or `server`. */
	kind: string;
	name: string;
	labels: Record<string, string>;
	address: string;
	assigneeId: number | null;
	status: string;
	location: string;
};

function toAddress(id: number, collection: string, kind: string) {
	if (collection === "servers" || kind === "ipv4") {
		return `203.0.113.${id % addressBytes}`;
	}
	return `2001:db8::${id.toString(hexRadix)}`;
}

/**
 * What a server says about one of its addresses. Once an allocation has made any address, the
 * absence of one means it was deleted; before that, a server created on its own gets a made-up
 * pair, because Hetzner gives every server an address unless it is told not to.
 */
function toReplyAddress(
	held: { id: number; address: string } | undefined,
	hadAddresses: boolean,
	invented: { id: number; ip: string },
) {
	if (held !== undefined) {
		return { id: held.id, ip: held.address };
	}
	return hadAddresses ? null : invented;
}

function notFound(): FakeReply {
	return {
		status: httpNotFound,
		// Hetzner always names a refusal and explains it; a fake that sent less would let our code
		// depend on a Hetzner that does not exist.
		body: {
			error: {
				code: "not_found",
				message: "resource not found",
				details: null,
			},
		},
	};
}

export type HetznerFake = Fake &
	Readonly<{
		/**
		 * Takes the project's rules off one server, as an admin can in Hetzner's own console. The
		 * server keeps running; what changes is what it is protected by. A run that meets Hetzner
		 * does it there, because a change to this fake's own memory would be a change to nothing.
		 */
		detachFirewall: (serverId: number) => Promise<void>;
		/** Stops one server without Composery asking, as an admin can in Hetzner's own console. */
		stopServer: (serverId: number) => Promise<void>;
	}>;

export async function startHetznerFake(): Promise<HetznerFake> {
	const resources = new Map<number, Resource>();
	const detachedFirewalls = new Set<number>();
	const actions = new Map<number, string>();
	let nextId = firstId;

	const startAction = () => {
		nextId += 1;
		actions.set(nextId, "success");
		return toActionReply(nextId, "success");
	};

	const toResourceReply = (resource: Resource) => {
		if (resource.collection === "primary_ips") {
			return toPrimaryIpReply({
				id: resource.id,
				name: resource.name,
				labels: resource.labels,
				ip: resource.address,
				type: resource.kind,
				assigneeId: resource.assigneeId,
				location: resource.location,
			});
		}
		const owned = [...resources.values()].filter(
			(item) =>
				item.collection === "primary_ips" &&
				item.labels["allocation-id"] === resource.labels["allocation-id"],
		);
		// A server reports the addresses it still has. One that was deleted is gone from the reply,
		// which is what Hetzner sends and what Composery has to read.
		const ipv4 = owned.find((item) => item.kind === "ipv4");
		const ipv6 = owned.find((item) => item.kind === "ipv6");
		const hadAddresses = owned.length > 0;
		return toServerReply({
			id: resource.id,
			name: resource.name,
			status: resource.status,
			labels: resource.labels,
			ipv4: toReplyAddress(ipv4, hadAddresses, {
				id: resource.id + ipv4Offset,
				ip: toAddress(resource.id, "servers", "ipv4"),
			}),
			ipv6: toReplyAddress(ipv6, hadAddresses, {
				id: resource.id + ipv6Offset,
				ip: toAddress(resource.id, "primary_ips", "ipv6"),
			}),
			firewallId: detachedFirewalls.has(resource.id)
				? null
				: controllerFirewallId,
			serverType: serverTypeName,
			location: resource.location,
			imageId,
			imageName: "ubuntu-24.04",
		});
	};

	const create = (collection: Collection, body: unknown) => {
		const fields = (body ?? {}) as {
			name?: string;
			labels?: Record<string, string>;
			location?: string;
			// biome-ignore lint/style/useNamingConvention: the Hetzner Cloud API names this field
			public_net?: { ipv4?: number; ipv6?: number };
		};
		nextId += 1;
		const labels = fields.labels ?? {};
		// Composery labels everything it creates; anything else is named by its collection.
		const kind =
			typeof labels["resource-kind"] === "string"
				? labels["resource-kind"]
				: collection;
		const resource: Resource = {
			id: nextId,
			collection,
			name: fields.name ?? `resource-${nextId}`,
			kind,
			labels,
			address: toAddress(nextId, collection, kind),
			assigneeId: null,
			status: "running",
			location: fields.location ?? firstLocation,
		};
		resources.set(resource.id, resource);
		// A server takes the addresses it was created with, as Hetzner assigns them.
		for (const addressId of [
			fields.public_net?.ipv4,
			fields.public_net?.ipv6,
		]) {
			const address =
				addressId === undefined ? undefined : resources.get(addressId);
			if (address !== undefined) {
				address.assigneeId = resource.id;
			}
		}
		return resource;
	};

	const list = (collection: Collection, query: URLSearchParams) => {
		const wanted = new Map(
			(query.get("label_selector") ?? "")
				.split(",")
				.filter(Boolean)
				.map((pair) => {
					const [key, value] = pair.split("=");
					return [key ?? "", value ?? ""] as const;
				}),
		);
		const name = query.get("name");
		return [...resources.values()].filter(
			(resource) =>
				resource.collection === collection &&
				(name === null || resource.name === name) &&
				[...wanted].every(([key, value]) => resource.labels[key] === value),
		);
	};

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one branch for each request Composery sends
	const answer = (method: string, path: string, body: unknown): FakeReply => {
		const [route, rawQuery] = path.split("?");
		const query = new URLSearchParams(rawQuery ?? "");
		const [collection, id, group, action] = (route ?? "")
			.split("/")
			.filter(Boolean);
		if (method === "GET" && collection === "firewalls") {
			return {
				status: httpOk,
				body: { firewall: toFirewallReply(Number(id), controllerId) },
			};
		}
		if (method === "GET" && collection === "server_types") {
			return {
				status: httpOk,
				body: {
					// biome-ignore lint/style/useNamingConvention: the Hetzner Cloud API names this field
					server_types: [toServerTypeReply(serverTypeName, locations)],
					meta: toPaginationReply(1),
				},
			};
		}
		if (method === "GET" && collection === "images") {
			return {
				status: httpOk,
				body: {
					images: [toImageReply(imageId, query.get("name") ?? "")],
					meta: toPaginationReply(1),
				},
			};
		}
		if (method === "GET" && collection === "actions") {
			const status = actions.get(Number(id));
			return status === undefined
				? notFound()
				: {
						status: httpOk,
						body: { action: toActionReply(Number(id), status) },
					};
		}
		if (collection !== "servers" && collection !== "primary_ips") {
			return notFound();
		}
		const single = collection === "servers" ? "server" : "primary_ip";
		if (method === "POST" && id === undefined) {
			const resource = create(collection, body);
			return {
				status: httpCreated,
				body: {
					[single]: toResourceReply(resource),
					action: startAction(),
					...(collection === "servers"
						? // biome-ignore lint/style/useNamingConvention: the Hetzner Cloud API names this field
							{ next_actions: [], root_password: null }
						: {}),
				},
			};
		}
		if (method === "POST" && group === "actions" && action !== undefined) {
			const resource = resources.get(Number(id));
			if (resource === undefined) {
				return notFound();
			}
			resource.status = action === "poweron" ? "running" : "off";
			return { status: httpCreated, body: { action: startAction() } };
		}
		if (method === "GET" && id === undefined) {
			const found = list(collection, query).map(toResourceReply);
			return {
				status: httpOk,
				body: { [collection]: found, meta: toPaginationReply(found.length) },
			};
		}
		if (method === "GET") {
			const resource = resources.get(Number(id));
			return resource === undefined
				? notFound()
				: { status: httpOk, body: { [single]: toResourceReply(resource) } };
		}
		if (method === "DELETE") {
			const resource = resources.get(Number(id));
			if (resource === undefined) {
				return notFound();
			}
			resources.delete(resource.id);
			// Hetzner frees an address that a deleted server held.
			for (const other of resources.values()) {
				if (other.assigneeId === resource.id) {
					other.assigneeId = null;
				}
			}
			return collection === "servers"
				? { status: httpOk, body: { action: startAction() } }
				: { status: httpNoContent, body: null };
		}
		return notFound();
	};

	// A run given a token for a project of its own asks Hetzner itself, through the same fake, so
	// the requests are still counted, the answers are still held to Hetzner's description, and a
	// test that loses a reply loses a real one.
	const token = getHetznerToken();
	const fake = await startFake({
		system: "Hetzner",
		checker: hetznerContract,
		answer: (request) => answer(request.method, request.path, request.body),
		...(token === null ? {} : { forward: toHetznerForward(token) }),
	});

	return {
		...fake,
		detachFirewall: async (serverId) => {
			if (token !== null) {
				await detachHetznerFirewalls(token, serverId);
				return;
			}
			detachedFirewalls.add(serverId);
		},
		stopServer: async (serverId) => {
			if (token !== null) {
				await stopHetznerServer(token, serverId);
				return;
			}
			const resource = resources.get(serverId);
			if (resource === undefined) {
				throw new Error(`Hetzner holds no server ${serverId}.`);
			}
			resource.status = "off";
		},
	};
}

let started: Promise<HetznerFake> | undefined;

/** One fake for the whole run, because the deployment holds its address. */
export function useHetznerFake() {
	started ??= startHetznerFake();
	return started;
}
