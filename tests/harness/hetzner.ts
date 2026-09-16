import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { registerCleanup } from "./cleanup";

/**
 * A stand-in for Hetzner: it answers the requests Composery sends, and it can produce the
 * outcomes Hetzner cannot be asked for, such as a reply that never arrives. It never decides
 * whether a test passes. What it knows about Hetzner is only what Composery reads: the fields
 * below, and the shapes that real runs have shown.
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
const apiPrefixPattern = /^\/v1\//;

/** What Composery sent, so a test can count creates or read a body. */
export type HetznerRequest = Readonly<{
	method: string;
	path: string;
	body: unknown;
}>;

/**
 * `answer` acts as Hetzner would. `lose` acts too, and then drops the connection, so Composery
 * learns nothing about a request that took effect. A status and code is a refusal.
 */
export type HetznerOutcome =
	| "answer"
	| "lose"
	| Readonly<{ status: number; code: string }>;

export type HetznerStandIn = Readonly<{
	/** The loopback address to give `HCLOUD_STAND_IN_URL`. */
	url: string;
	/** Every request in order, oldest first. */
	requests: () => readonly HetznerRequest[];
	countRequests: (method: string, path: RegExp) => number;
	/** Applies once, to the next request that matches. */
	scriptOnce: (
		match: Readonly<{ method: string; path: RegExp }>,
		outcome: HetznerOutcome,
	) => void;
	stop: () => void;
}>;

type Resource = {
	id: number;
	collection: "servers" | "primary_ips";
	name: string;
	labels: Record<string, string>;
	address: string;
	assigneeId: number | null;
	status: string;
};

type Script = {
	method: string;
	path: RegExp;
	outcome: HetznerOutcome;
};

const controllerFirewallId = 77;
const imageId = 501;
const serverTypeName = "cx23";
const locations = ["nbg1", "fsn1", "hel1"];

function toAddress(
	id: number,
	collection: string,
	labels: Record<string, string>,
) {
	const kind = labels["resource-kind"];
	if (collection === "servers" || kind === "ipv4") {
		return `203.0.113.${id % addressBytes}`;
	}
	return `2001:db8::${id.toString(hexRadix)}`;
}

function toPublicNet(resource: Resource, owned: readonly Resource[]) {
	const ipv4 = owned.find((item) => item.labels["resource-kind"] === "ipv4");
	const ipv6 = owned.find((item) => item.labels["resource-kind"] === "ipv6");
	// biome-ignore-start lint/style/useNamingConvention: the Hetzner Cloud API names these fields
	return {
		ipv4: {
			id: ipv4?.id ?? resource.id + ipv4Offset,
			ip: ipv4?.address ?? `203.0.113.${resource.id % addressBytes}`,
		},
		ipv6: {
			id: ipv6?.id ?? resource.id + ipv6Offset,
			ip: ipv6?.address ?? `2001:db8::${resource.id.toString(hexRadix)}`,
		},
		firewalls: [{ id: controllerFirewallId, status: "applied" }],
	};
	// biome-ignore-end lint/style/useNamingConvention: the Hetzner Cloud API names these fields
}

async function startHetznerStandIn(): Promise<HetznerStandIn> {
	const requests: HetznerRequest[] = [];
	const resources = new Map<number, Resource>();
	const actions = new Map<number, string>();
	const scripts: Script[] = [];
	let nextId = firstId;

	const takeScript = (method: string, route: string) => {
		const index = scripts.findIndex(
			(candidate) => candidate.method === method && candidate.path.test(route),
		);
		if (index === -1) {
			return "answer" as const;
		}
		const [script] = scripts.splice(index, 1);
		return script?.outcome ?? ("answer" as const);
	};

	const startAction = () => {
		nextId += 1;
		actions.set(nextId, "success");
		return { id: nextId, status: "success", error: null };
	};

	const toResourceReply = (resource: Resource) => {
		const owned = [...resources.values()].filter(
			(item) =>
				item.labels["allocation-id"] === resource.labels["allocation-id"],
		);
		// biome-ignore-start lint/style/useNamingConvention: the Hetzner Cloud API names these fields
		return resource.collection === "servers"
			? {
					id: resource.id,
					name: resource.name,
					status: resource.status,
					labels: resource.labels,
					server_type: { name: serverTypeName },
					location: { name: locations[0] },
					public_net: toPublicNet(resource, owned),
				}
			: {
					id: resource.id,
					name: resource.name,
					labels: resource.labels,
					ip: resource.address,
					type: resource.labels["resource-kind"],
					assignee_id: resource.assigneeId,
				};
		// biome-ignore-end lint/style/useNamingConvention: the Hetzner Cloud API names these fields
	};

	const create = (collection: Resource["collection"], body: unknown) => {
		const fields = (body ?? {}) as {
			name?: string;
			labels?: Record<string, string>;
			// biome-ignore lint/style/useNamingConvention: the Hetzner Cloud API names this field
			public_net?: { ipv4?: number; ipv6?: number };
		};
		nextId += 1;
		const labels = fields.labels ?? {};
		const resource: Resource = {
			id: nextId,
			collection,
			name: fields.name ?? `resource-${nextId}`,
			labels,
			address: toAddress(nextId, collection, labels),
			assigneeId: null,
			status: "running",
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

	const list = (collection: Resource["collection"], query: URLSearchParams) => {
		const selector = query.get("label_selector") ?? "";
		const wanted = new Map(
			selector
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
	const answer = (method: string, path: string, body: unknown) => {
		const [route, rawQuery] = path.split("?");
		const query = new URLSearchParams(rawQuery ?? "");
		const segments = (route ?? "").split("/").filter(Boolean);
		const [collection, id, group, action] = segments;
		if (method === "GET" && collection === "firewalls") {
			return {
				status: httpOk,
				body: {
					firewall: {
						id: Number(id),
						labels: { "controller-id": "composery-test" },
					},
				},
			};
		}
		if (method === "GET" && collection === "server_types") {
			return {
				status: httpOk,
				body: {
					// biome-ignore lint/style/useNamingConvention: the Hetzner Cloud API names this field
					server_types: [
						{
							name: serverTypeName,
							architecture: "x86",
							locations: locations.map((supported) => ({
								name: supported,
								deprecation: null,
								available: true,
							})),
						},
					],
				},
			};
		}
		if (method === "GET" && collection === "images") {
			return {
				status: httpOk,
				body: {
					images: [
						{
							id: imageId,
							name: query.get("name"),
							architecture: "x86",
							status: "available",
							deprecation: null,
						},
					],
				},
			};
		}
		if (method === "GET" && collection === "actions") {
			const status = actions.get(Number(id));
			return status === undefined
				? { status: httpNotFound, body: { error: { code: "not_found" } } }
				: { status: httpOk, body: { action: { id: Number(id), status } } };
		}
		if (collection !== "servers" && collection !== "primary_ips") {
			return { status: httpNotFound, body: { error: { code: "not_found" } } };
		}
		if (method === "POST" && id === undefined) {
			const resource = create(collection, body);
			const key = collection === "servers" ? "server" : "primary_ip";
			return {
				status: httpCreated,
				body: { [key]: toResourceReply(resource), action: startAction() },
			};
		}
		if (method === "POST" && group === "actions" && action !== undefined) {
			const resource = resources.get(Number(id));
			if (resource === undefined) {
				return { status: httpNotFound, body: { error: { code: "not_found" } } };
			}
			resource.status = action === "poweron" ? "running" : "off";
			return { status: httpCreated, body: { action: startAction() } };
		}
		if (method === "GET" && id === undefined) {
			return {
				status: httpOk,
				body: {
					[collection]: list(collection, query).map(toResourceReply),
					// biome-ignore lint/style/useNamingConvention: the Hetzner Cloud API names this field
					meta: { pagination: { next_page: null } },
				},
			};
		}
		if (method === "GET") {
			const resource = resources.get(Number(id));
			return resource === undefined
				? { status: httpNotFound, body: { error: { code: "not_found" } } }
				: {
						status: httpOk,
						body: {
							[collection === "servers" ? "server" : "primary_ip"]:
								toResourceReply(resource),
						},
					};
		}
		if (method === "DELETE") {
			if (!resources.delete(Number(id))) {
				return { status: httpNotFound, body: { error: { code: "not_found" } } };
			}
			return collection === "servers"
				? { status: httpOk, body: { action: startAction() } }
				: { status: httpNoContent, body: null };
		}
		return { status: httpNotFound, body: { error: { code: "not_found" } } };
	};

	const handle = (
		request: IncomingMessage,
		response: ServerResponse,
		body: unknown,
	) => {
		const method = request.method ?? "GET";
		// Composery calls the same paths it calls at Hetzner, under the same prefix.
		const path = (request.url ?? "").replace(apiPrefixPattern, "");
		requests.push({ method, path, body });
		const outcome = takeScript(method, path);
		if (outcome === "lose") {
			// Hetzner did the work; the answer never arrives. Composery must not assume it failed.
			answer(method, path, body);
			request.socket.destroy();
			return;
		}
		if (outcome !== "answer") {
			response.writeHead(outcome.status, {
				"content-type": "application/json",
			});
			response.end(JSON.stringify({ error: { code: outcome.code } }));
			return;
		}
		const result = answer(method, path, body);
		if (result.body === null) {
			response.writeHead(result.status);
			response.end();
			return;
		}
		response.writeHead(result.status, { "content-type": "application/json" });
		response.end(JSON.stringify(result.body));
	};

	const server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			let body: unknown;
			try {
				body =
					chunks.length === 0
						? undefined
						: JSON.parse(Buffer.concat(chunks).toString());
			} catch {
				body = undefined;
			}
			handle(request, response, body);
		});
	});
	const stop = () => {
		server.closeAllConnections();
		server.close();
	};
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", resolve);
	});
	registerCleanup(stop);
	const address = server.address();
	if (typeof address !== "object" || address === null) {
		stop();
		throw new Error("The Hetzner stand-in did not take a port.");
	}

	return {
		url: `http://127.0.0.1:${address.port}`,
		requests: () => requests,
		countRequests: (method, path) =>
			requests.filter(
				(request) => request.method === method && path.test(request.path),
			).length,
		scriptOnce: (match, outcome) => {
			scripts.push({ ...match, outcome });
		},
		stop,
	};
}

let standIn: Promise<HetznerStandIn> | undefined;

/** One stand-in for the whole run, because the deployment holds its address. */
export function useHetznerStandIn() {
	standIn ??= startHetznerStandIn();
	return standIn;
}
