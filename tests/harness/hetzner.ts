import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { registerCleanup } from "./cleanup";
import {
	listHetznerReplyProblems,
	listHetznerRequestProblems,
} from "./hetzner-contract";
import {
	toActionReply,
	toFirewallReply,
	toImageReply,
	toPaginationReply,
	toPrimaryIpReply,
	toServerReply,
	toServerTypeReply,
} from "./hetzner-replies";

/**
 * A fake for Hetzner: it answers the requests Composery sends, and it can produce the
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

export type HetznerFake = Readonly<{
	/** The loopback address to give `HCLOUD_FAKE_URL`. */
	url: string;
	/** Every request in order, oldest first. */
	requests: () => readonly HetznerRequest[];
	/** Every way a reply differed from Hetzner's own description of it. */
	problems: () => readonly string[];
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
	/** What Composery's own label says this is: `ipv4`, `ipv6`, or `server`. */
	kind: string;
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
const controllerId = "composery-test";
const imageId = 501;
const serverTypeName = "cx23";
const locations = ["nbg1", "fsn1", "hel1"];
const firstLocation = "nbg1";

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

async function startHetznerFake(): Promise<HetznerFake> {
	const requests: HetznerRequest[] = [];
	const problems: string[] = [];
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
		return toActionReply(nextId, "success");
	};

	const toResourceReply = (resource: Resource) => {
		const owned = [...resources.values()].filter(
			(item) =>
				item.labels["allocation-id"] === resource.labels["allocation-id"],
		);
		const ipv4 = owned.find((item) => item.labels["resource-kind"] === "ipv4");
		const ipv6 = owned.find((item) => item.labels["resource-kind"] === "ipv6");
		if (resource.collection === "primary_ips") {
			return toPrimaryIpReply({
				id: resource.id,
				name: resource.name,
				labels: resource.labels,
				ip: resource.address,
				type: resource.kind,
				assigneeId: resource.assigneeId,
				location: firstLocation,
			});
		}
		return toServerReply({
			id: resource.id,
			name: resource.name,
			status: resource.status,
			labels: resource.labels,
			ipv4: {
				id: ipv4?.id ?? resource.id + ipv4Offset,
				ip: ipv4?.address ?? `203.0.113.${resource.id % addressBytes}`,
			},
			ipv6: {
				id: ipv6?.id ?? resource.id + ipv6Offset,
				ip: ipv6?.address ?? `2001:db8::${resource.id.toString(hexRadix)}`,
			},
			firewallId: controllerFirewallId,
			serverType: serverTypeName,
			location: firstLocation,
			imageId,
			imageName: "ubuntu-24.04",
		});
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
					firewall: toFirewallReply(Number(id), controllerId),
				},
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
				? { status: httpNotFound, body: { error: { code: "not_found" } } }
				: {
						status: httpOk,
						body: { action: toActionReply(Number(id), status) },
					};
		}
		if (collection !== "servers" && collection !== "primary_ips") {
			return { status: httpNotFound, body: { error: { code: "not_found" } } };
		}
		if (method === "POST" && id === undefined) {
			const resource = create(collection, body);
			const key = collection === "servers" ? "server" : "primary_ip";
			return {
				status: httpCreated,
				body: {
					[key]: toResourceReply(resource),
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
				return { status: httpNotFound, body: { error: { code: "not_found" } } };
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
		// Composery's own request is held to the same description as the reply.
		void listHetznerRequestProblems(method, path, body).then((found) =>
			problems.push(...found),
		);
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
		// Hetzner's own description decides whether it could have sent this. The reply is already
		// on its way, so a difference is recorded and fails the run at the end.
		void listHetznerReplyProblems(
			method,
			path,
			result.status,
			result.body ?? {},
		).then((found) => problems.push(...found));
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
		throw new Error("The Hetzner fake did not take a port.");
	}

	return {
		url: `http://127.0.0.1:${address.port}`,
		requests: () => requests,
		problems: () => problems,
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

let fake: Promise<HetznerFake> | undefined;
let running: HetznerFake | undefined;

/**
 * Fails the run when the fake answered in a shape Hetzner never would. It is checked once for the
 * whole run, because the test that makes a request is not always the one that would read it.
 */
export function listHetznerFakeProblems() {
	return running?.problems() ?? [];
}

/** Fails the run when the fake, or Composery, spoke to Hetzner in a way Hetzner describes otherwise. */
export function requireHetznerContractKept() {
	const problems = listHetznerFakeProblems();
	if (problems.length > 0) {
		const lines = [
			"The fake answered in ways Hetzner would not:",
			...new Set(problems),
		];
		throw new Error(lines.join("\n"));
	}
}

/** One fake for the whole run, because the deployment holds its address. */
export function useHetznerFake() {
	fake ??= startHetznerFake().then((started) => {
		running = started;
		return started;
	});
	return fake;
}
