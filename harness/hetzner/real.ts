import { randomBytes } from "node:crypto";
import { registerCleanup } from "../cleanup";
import type { FakeReply, FakeRequest } from "../fake";

/**
 * The real Hetzner Cloud API, for a run that was given a token for it. Everything here is about a
 * project that holds nothing else: the run labels what it makes, removes it at the end, and removes
 * what an earlier run left behind, so anything still in that project is a leak somebody can see.
 *
 * Put the token in `.env.test` and run `HETZNER=real bun test tests/convex/allocations`.
 */

const apiUrl = "https://api.hetzner.cloud/v1";
const controllerPrefix = "test-";
const runTagBytes = 5;
const leftoverAgeMs = 3_600_000;
const collections = ["servers", "primary_ips", "firewalls"] as const;
const httpNoContent = 204;

type Collection = (typeof collections)[number];
type Owned = { id: number; created: string; labels: Record<string, string> };

/**
 * The token for the project this run may use, or nothing, which keeps the fake a fake.
 *
 * `HETZNER` says which one this run wants, and nothing else does: a token that is merely present
 * changes nothing, so the credentials can stay in `.env.test` between runs. The file holds the
 * default and the environment beats the file, so `HETZNER=real bun test ...` meets Hetzner for one
 * run and `HETZNER=fake bun test` keeps the fake for one run.
 *
 * A run that asked for the real thing and was given no token fails here rather than falling back,
 * because it would otherwise report success in the same words as a run that met Hetzner.
 */
export function getHetznerToken() {
	if (process.env.HETZNER !== "real") {
		return null;
	}
	const token = process.env.HCLOUD_TOKEN;
	if (token === undefined || token === "") {
		throw new Error(
			"This run asked for the real Hetzner and HCLOUD_TOKEN holds nothing. Fill it in, or set HETZNER=fake.",
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
	const reply = await fetch(`${apiUrl}${path}`, {
		method,
		headers: {
			authorization: `Bearer ${token}`,
			...(body === undefined ? {} : { "content-type": "application/json" }),
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
	const text = await reply.text();
	return {
		status: reply.status,
		body: text === "" ? null : (JSON.parse(text) as unknown),
	};
}

/** Passes one request on to Hetzner and brings back exactly what Hetzner said. */
export function toHetznerForward(token: string) {
	return async (request: FakeRequest): Promise<FakeReply> =>
		await call(token, request.method, request.path, request.body);
}

async function listOwned(token: string, collection: Collection) {
	const { body } = await call(
		token,
		"GET",
		`${collection.startsWith("/") ? "" : "/"}${collection}?per_page=50`,
	);
	const held = (body as Record<string, Owned[]> | null)?.[collection] ?? [];
	return held.filter((item) =>
		(item.labels["controller-id"] ?? "").startsWith(controllerPrefix),
	);
}

async function remove(token: string, collection: Collection, id: number) {
	const { status } = await call(token, "DELETE", `/${collection}/${id}`);
	return status < httpNoContent + 1;
}

/**
 * Removes what this run made, and what a run that was killed left behind. A server is deleted
 * first: Hetzner frees the addresses it held, and a firewall still applied to it cannot go.
 */
export async function removeHetznerLeftovers(
	token: string,
	controllerId: string | null,
) {
	const isOurs = (item: Owned) =>
		controllerId === null
			? Date.now() - Date.parse(item.created) > leftoverAgeMs
			: item.labels["controller-id"] === controllerId;
	for (const collection of collections) {
		for (const item of (await listOwned(token, collection)).filter(isOurs)) {
			await remove(token, collection, item.id);
		}
	}
}

/**
 * Makes this run its own place in the project: one controller identifier that belongs to it alone,
 * and one firewall labelled with that, because the deployment refuses a firewall that is not its
 * own. What an earlier run left behind goes first, and what this one makes goes at the end.
 */
export async function createHetznerRun(token: string) {
	const controllerId = `${controllerPrefix}${randomBytes(runTagBytes).toString("hex")}`;
	await removeHetznerLeftovers(token, null);
	const { body } = await call(token, "POST", "/firewalls", {
		name: controllerId,
		labels: { "controller-id": controllerId },
		rules: [],
	});
	const firewall = (body as { firewall?: { id?: number } } | null)?.firewall;
	if (firewall?.id === undefined) {
		throw new Error(`Hetzner did not make a firewall: ${JSON.stringify(body)}`);
	}
	registerCleanup(async () => {
		await removeHetznerLeftovers(token, controllerId);
	});
	return { controllerId, firewallId: firewall.id };
}
