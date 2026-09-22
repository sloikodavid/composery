import { createHetznerContractChecker } from "../../contracts/hetzner";
import { type Fake, type FakeReply, startFake } from "../fake";
import {
	detachHetznerFirewalls,
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
const fakeServerType = "cx23";
const locations = ["nbg1", "fsn1", "hel1"] as const;
const firstLocation = locations[0];
const hourlyLimit = 3600;
const millisecondsPerSecond = 1000;

type Collection = "servers" | "primary_ips";

type Asked = Readonly<{
	method: string;
	id: string | undefined;
	group: string | undefined;
	action: string | undefined;
	query: URLSearchParams;
	body: unknown;
}>;

type Resource = {
	id: number;
	collection: Collection;
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

function toReplyAddress(
	held: { id: number; address: string } | undefined,
	hadAddresses: boolean,
	invented: { id: number; ip: string },
) {
	// A deleted address disappears from the server reply.
	if (held !== undefined) {
		return { id: held.id, ip: held.address };
	}
	return hadAddresses ? null : invented;
}

function notFound(): FakeReply {
	return {
		status: httpNotFound,
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
		controllerId: string;
		serverType: string;
		locations: readonly string[];
		/** Simulates an admin detaching the controller firewall. */
		detachFirewall: (serverId: number) => Promise<void>;
		/** Simulates an admin stopping a server. */
		stopServer: (serverId: number) => Promise<void>;
	}>;

/** Fake provider responses are checked against the recorded Hetzner contract. */
export async function startHetznerFake(
	token: string | null,
): Promise<HetznerFake> {
	const hetznerContract = createHetznerContractChecker();
	const resources = new Map<number, Resource>();
	const detachedFirewalls = new Set<number>();
	let firewallRules: unknown[] = [];
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
			serverType: fakeServerType,
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
			// biome-ignore lint/style/useNamingConvention: external field name
			public_net?: { ipv4?: number; ipv6?: number };
		};
		nextId += 1;
		const labels = fields.labels ?? {};
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

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one branch per firewall request
	const answerFirewall = (request: Asked): FakeReply => {
		const { method, id, group, action, query, body } = request;
		if (method === "GET" && id === undefined) {
			const wanted = query.get("label_selector") ?? "";
			const mine = wanted === `controller-id=${controllerId}`;
			return {
				status: httpOk,
				body: {
					firewalls: mine
						? [
								toFirewallReply(
									controllerFirewallId,
									controllerId,
									firewallRules,
								),
							]
						: [],
					meta: toPaginationReply(mine ? 1 : 0),
				},
			};
		}
		if (method === "GET") {
			return {
				status: httpOk,
				body: {
					firewall: toFirewallReply(Number(id), controllerId, firewallRules),
				},
			};
		}
		if (method === "POST" && id === undefined) {
			firewallRules = toRules(body);
			return {
				status: httpCreated,
				body: {
					firewall: toFirewallReply(
						controllerFirewallId,
						controllerId,
						firewallRules,
					),
					actions: [],
				},
			};
		}
		if (method === "POST" && group === "actions" && action === "set_rules") {
			firewallRules = toRules(body);
			return { status: httpCreated, body: { actions: [startAction()] } };
		}
		if (
			method === "POST" &&
			group === "actions" &&
			action === "apply_to_resources"
		) {
			for (const serverId of toAppliedServerIds(body)) {
				detachedFirewalls.delete(serverId);
			}
			return { status: httpCreated, body: { actions: [startAction()] } };
		}
		return notFound();
	};

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one branch per request
	const answer = (method: string, path: string, body: unknown): FakeReply => {
		const [route, rawQuery] = path.split("?");
		const query = new URLSearchParams(rawQuery ?? "");
		const [collection, id, group, action] = (route ?? "")
			.split("/")
			.filter(Boolean);
		if (collection === "firewalls") {
			return answerFirewall({ method, id, group, action, query, body });
		}
		if (method === "GET" && collection === "server_types") {
			return {
				status: httpOk,
				body: {
					// biome-ignore lint/style/useNamingConvention: external field name
					server_types: [toServerTypeReply(fakeServerType, locations)],
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
						? // biome-ignore lint/style/useNamingConvention: external field name
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

	let remaining = hourlyLimit;
	let countedAt = Date.now();
	// Match Hetzner's rate-limit headers and gradual refill.
	const withBudget = (reply: FakeReply): FakeReply => {
		const now = Date.now();
		const returned = Math.floor((now - countedAt) / millisecondsPerSecond);
		remaining = Math.min(hourlyLimit, remaining + returned);
		countedAt += returned * millisecondsPerSecond;
		remaining = Math.max(0, remaining - 1);
		const resetAt = Math.ceil(
			now / millisecondsPerSecond + (hourlyLimit - remaining),
		);
		return {
			...reply,
			headers: {
				...reply.headers,
				"RateLimit-Limit": String(hourlyLimit),
				"RateLimit-Remaining": String(remaining),
				"RateLimit-Reset": String(resetAt),
			},
		};
	};

	const fake = await startFake({
		system: "Hetzner",
		checker: hetznerContract,
		answer: (request) =>
			withBudget(answer(request.method, request.path, request.body)),
		observe: (reply) => {
			const stated = Number(reply.headers?.["RateLimit-Remaining"]);
			if (token === null && Number.isSafeInteger(stated)) {
				remaining = stated;
				countedAt = Date.now();
			}
		},
		...(token === null ? {} : { forward: toHetznerForward(token) }),
	});

	return {
		...fake,
		controllerId,
		serverType: fakeServerType,
		locations,
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

function toRules(body: unknown) {
	const rules = (body as { rules?: unknown } | undefined)?.rules;
	return Array.isArray(rules) ? rules : [];
}

function toAppliedServerIds(body: unknown) {
	// biome-ignore lint/style/useNamingConvention: external field name
	const applied = (body as { apply_to?: unknown } | undefined)?.apply_to;
	return (Array.isArray(applied) ? applied : [])
		.map((item) => (item as { server?: { id?: unknown } }).server?.id)
		.filter((id): id is number => typeof id === "number");
}
