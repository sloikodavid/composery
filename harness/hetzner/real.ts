import { randomBytes } from "node:crypto";
import { hetznerCloudFirewallRules } from "../../convex/allocations/hetzner_cloud/firewall";
import {
	hetznerCloudApiPrefix,
	hetznerCloudOrigin,
} from "../../convex/allocations/hetzner_cloud/origin";
import { registerCleanup } from "../cleanup";
import type { FakeReply, FakeRequest } from "../fake";

const controllerPrefix = "test-";
const runTagBytes = 5;
const leftoverAgeMs = 3_600_000;
// Deletes are asynchronous; cleanup waits for absence.
const removeTimeoutMs = 180_000;
const removeDelayMs = 3000;
const collections = ["servers", "primary_ips", "firewalls"] as const;
const httpNotFound = 404;

type Collection = (typeof collections)[number];
type Owned = { id: number; created: string; labels: Record<string, string> };
type HetznerRequest = (
	token: string,
	method: string,
	path: string,
	body?: unknown,
) => Promise<{ status: number; body: unknown }>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOwned(value: unknown): value is Owned {
	if (!isRecord(value)) {
		return false;
	}
	if (
		typeof value.id !== "number" ||
		!Number.isInteger(value.id) ||
		typeof value.created !== "string" ||
		!isRecord(value.labels)
	) {
		return false;
	}
	return Object.values(value.labels).every(
		(label) => typeof label === "string",
	);
}

function readOwnedPage(collection: Collection, page: number, body: unknown) {
	if (!isRecord(body)) {
		throw new Error(`Hetzner returned no ${collection} list during cleanup.`);
	}
	const rawItems = body[collection];
	if (!Array.isArray(rawItems) || !rawItems.every(isOwned)) {
		throw new Error(
			`Hetzner returned malformed ${collection} rows during cleanup.`,
		);
	}
	const meta = body.meta;
	const pagination = isRecord(meta) ? meta.pagination : undefined;
	if (!isRecord(pagination)) {
		throw new Error(
			`Hetzner returned no pagination for ${collection} cleanup.`,
		);
	}
	const reportedPage = pagination.page;
	const next = pagination.next_page;
	if (!Number.isInteger(reportedPage) || reportedPage !== page) {
		throw new Error(`Hetzner returned the wrong ${collection} cleanup page.`);
	}
	if (
		next !== null &&
		(typeof next !== "number" || !Number.isInteger(next) || next <= page)
	) {
		throw new Error(`Hetzner returned a non-progressing ${collection} page.`);
	}
	return { items: rawItems, next };
}

/** Only HCLOUD_MODE=real enables Hetzner; credentials alone do not. */
export function getHetznerToken() {
	if (process.env.HCLOUD_MODE !== "real") {
		return null;
	}
	const token = process.env.HCLOUD_TOKEN;
	if (token === undefined || token === "") {
		throw new Error(
			"This run asked for the real Hetzner and HCLOUD_TOKEN holds nothing. Fill it in, or set HCLOUD_MODE=fake.",
		);
	}
	return token;
}

async function call(
	token: string,
	method: string,
	path: string,
	body?: unknown,
) {
	const reply = await fetch(
		`${hetznerCloudOrigin}${hetznerCloudApiPrefix}${path}`,
		{
			method,
			headers: {
				authorization: `Bearer ${token}`,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		},
	);
	const text = await reply.text();
	return {
		status: reply.status,
		body: text === "" ? null : (JSON.parse(text) as unknown),
	};
}

export function toHetznerForward(token: string) {
	return async (request: FakeRequest): Promise<FakeReply> =>
		await call(token, request.method, request.path, request.body);
}

async function listOwned(
	token: string,
	collection: Collection,
	request: HetznerRequest = call,
) {
	const held: Owned[] = [];
	for (let page = 1; ; ) {
		const reply = await request(
			token,
			"GET",
			`${collection.startsWith("/") ? "" : "/"}${collection}?per_page=50&page=${page}`,
		);
		if (reply.status >= httpMultipleChoices) {
			throw new Error(
				`Hetzner refused the cleanup list for ${collection}: ${reply.status}`,
			);
		}
		const { items, next } = readOwnedPage(collection, page, reply.body);
		held.push(...items);
		if (next === null) {
			break;
		}
		page = next;
	}
	return held.filter((item) =>
		(item.labels["controller-id"] ?? "").startsWith(controllerPrefix),
	);
}

async function remove(
	token: string,
	collection: Collection,
	id: number,
	request: HetznerRequest = call,
) {
	const reply = await request(token, "DELETE", `/${collection}/${id}`);
	if (reply.status >= httpMultipleChoices && reply.status !== httpNotFound) {
		throw new Error(
			`Hetzner refused cleanup of ${collection} ${id}: ${reply.status}`,
		);
	}
}

/** Servers go before addresses and firewalls; leftovers are reported as leaks. */
export async function removeHetznerLeftovers(
	token: string,
	controllerId: string | null,
	kinds: readonly Collection[] = collections,
	request: HetznerRequest = call,
) {
	const isOurs = (item: Owned) =>
		controllerId === null
			? Date.now() - Date.parse(item.created) > leftoverAgeMs
			: item.labels["controller-id"] === controllerId;
	const deadline = Date.now() + removeTimeoutMs;
	for (const collection of kinds) {
		let held = (await listOwned(token, collection, request)).filter(isOurs);
		while (held.length > 0) {
			for (const item of held) {
				await remove(token, collection, item.id, request);
			}
			if (Date.now() > deadline) {
				throw new Error(
					`Hetzner still holds ${held.length} of this run's ${collection}: ${held
						.map((item) => item.id)
						.join(", ")}`,
				);
			}
			await Bun.sleep(removeDelayMs);
			held = (await listOwned(token, collection, request)).filter(isOurs);
		}
	}
}

let run: Readonly<{ token: string; controllerId: string }> | undefined;

export async function removeHetznerRunResources() {
	if (run !== undefined) {
		await removeHetznerLeftovers(run.token, run.controllerId, [
			"servers",
			"primary_ips",
		]);
	}
}

/** Each real run owns one controller label and firewall. */
export async function createHetznerRun(token: string) {
	const controllerId = `${controllerPrefix}${randomBytes(runTagBytes).toString("hex")}`;
	await removeHetznerLeftovers(token, null);
	const { body } = await call(token, "POST", "/firewalls", {
		name: controllerId,
		labels: { "controller-id": controllerId },
		rules: hetznerCloudFirewallRules,
	});
	const firewall = (body as { firewall?: { id?: number } } | null)?.firewall;
	if (firewall?.id === undefined) {
		throw new Error(`Hetzner did not make a firewall: ${JSON.stringify(body)}`);
	}
	run = { token, controllerId };
	registerCleanup(async () => {
		await removeHetznerLeftovers(token, controllerId);
	});
	return { controllerId, firewallId: firewall.id };
}

const httpMultipleChoices = 300;

async function require2xx(
	token: string,
	method: string,
	path: string,
	body?: unknown,
) {
	const reply = await call(token, method, path, body);
	if (reply.status >= httpMultipleChoices) {
		throw new Error(`Hetzner refused ${method} ${path}: ${reply.status}`);
	}
	return reply.body;
}

const settleTimeoutMs = 60_000;
const settleDelayMs = 500;

async function readServer(token: string, serverId: number) {
	const body = await require2xx(token, "GET", `/servers/${serverId}`);
	return (
		(body as { server?: { status?: string; firewalls?: { id?: number }[] } })
			.server ?? {}
	);
}

/** Provider actions are asynchronous; read state only after settlement. */
async function waitUntil(
	token: string,
	serverId: number,
	done: (server: Awaited<ReturnType<typeof readServer>>) => boolean,
	what: string,
) {
	const deadline = Date.now() + settleTimeoutMs;
	while (Date.now() < deadline) {
		if (done(await readServer(token, serverId))) {
			return;
		}
		await Bun.sleep(settleDelayMs);
	}
	throw new Error(`Hetzner did not ${what} server ${serverId} in time.`);
}

export async function stopHetznerServer(token: string, serverId: number) {
	await require2xx(token, "POST", `/servers/${serverId}/actions/poweroff`);
	await waitUntil(token, serverId, (server) => server.status === "off", "stop");
}

export async function detachHetznerFirewalls(token: string, serverId: number) {
	const attached = (await readServer(token, serverId)).firewalls ?? [];
	for (const firewall of attached) {
		if (typeof firewall.id !== "number") {
			continue;
		}
		await require2xx(
			token,
			"POST",
			`/firewalls/${firewall.id}/actions/remove_from_resources`,
			// biome-ignore lint/style/useNamingConvention: external field names
			{ remove_from: [{ type: "server", server: { id: serverId } }] },
		);
	}
	await waitUntil(
		token,
		serverId,
		(server) => (server.firewalls ?? []).length === 0,
		"take the rules off",
	);
}
