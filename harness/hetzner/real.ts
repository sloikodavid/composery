import { randomBytes } from "node:crypto";
import { hetznerCloudFirewallRules } from "../../convex/allocations/hetzner_cloud/firewall";
import {
	hetznerCloudApiPrefix,
	hetznerCloudOrigin,
} from "../../convex/allocations/hetzner_cloud/origin";
import { registerCleanup } from "../cleanup";
import type { FakeReply, FakeRequest } from "../fake";

/**
 * The real Hetzner Cloud API, for a run that was given a token for it. Everything here is about a
 * project that holds nothing else: the run labels what it makes, removes it at the end, and removes
 * what an earlier run left behind, so anything still in that project is a leak somebody can see.
 *
 * Put the token in `.env.test` and run `HCLOUD_MODE=real bun test tests/convex/allocations`.
 */

const controllerPrefix = "test-";
const runTagBytes = 5;
const leftoverAgeMs = 3_600_000;
// A delete is answered before the provider has carried it out, so removal is asked for again
// until nothing of that kind is left, and given long enough for a server to actually go.
const removeTimeoutMs = 180_000;
const removeDelayMs = 3000;
const collections = ["servers", "primary_ips", "firewalls"] as const;
const httpNoContent = 204;

type Collection = (typeof collections)[number];
type Owned = { id: number; created: string; labels: Record<string, string> };

/**
 * The token for the project this run may use, or nothing, which keeps the fake a fake.
 *
 * `HCLOUD_MODE` says which one this run wants, and nothing else does: a token that is merely
 * present changes nothing, so the credentials can stay in `.env.test` between runs. The file holds
 * the default and the environment beats the file, so `HCLOUD_MODE=real bun test ...` meets Hetzner
 * for one run and `HCLOUD_MODE=fake bun test` keeps the fake for one run. One spelling spends
 * money and everything else, including nothing at all, does not.
 *
 * A run that asked for the real thing and was given no token fails here rather than falling back,
 * because it would otherwise report success in the same words as a run that met Hetzner.
 */
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
 * Removes what this run made, and what a run that was killed left behind.
 *
 * A server is deleted first, because Hetzner frees the addresses it held and a firewall still
 * applied to it cannot go. That order is not enough on its own: a delete is answered before it has
 * happened, so each kind is asked for again until the provider says there are none left. Asking
 * once and reading the first refusal as "done" is how a firewall survived a run that passed.
 *
 * What cannot be removed is raised, because the only thing that makes "anything left in this
 * project is a leak" true is that a run says so when it leaves one.
 */
export async function removeHetznerLeftovers(
	token: string,
	controllerId: string | null,
	kinds: readonly Collection[] = collections,
) {
	const isOurs = (item: Owned) =>
		controllerId === null
			? Date.now() - Date.parse(item.created) > leftoverAgeMs
			: item.labels["controller-id"] === controllerId;
	const deadline = Date.now() + removeTimeoutMs;
	for (const collection of kinds) {
		let held = (await listOwned(token, collection)).filter(isOurs);
		while (held.length > 0) {
			for (const item of held) {
				await remove(token, collection, item.id);
			}
			if (Date.now() > deadline) {
				throw new Error(
					`Hetzner still holds ${held.length} of this run's ${collection}: ${held
						.map((item) => item.id)
						.join(", ")}`,
				);
			}
			await Bun.sleep(removeDelayMs);
			held = (await listOwned(token, collection)).filter(isOurs);
		}
	}
}

/** What this run holds at Hetzner, for whoever has to take it away again. */
let run: Readonly<{ token: string; controllerId: string }> | undefined;

/**
 * Removes what a finished test made, and does nothing at all for a run that never met Hetzner. A
 * test's server is nobody's once that test ends, and a project holds a fixed number of them, so
 * clearing them as they are finished with keeps what a run holds at once away from that limit.
 *
 * The firewall is not a test's: the deployment refuses to act on an allocation whose project
 * firewall is gone, so taking it away between tests would leave every later one stuck on it. It
 * belongs to the run and goes with the run.
 */
export async function removeHetznerRunResources() {
	if (run !== undefined) {
		await removeHetznerLeftovers(run.token, run.controllerId, [
			"servers",
			"primary_ips",
		]);
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
		// The rules a deployment states, so a run meets the project a deployment would have.
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

/** What Hetzner says about one server right now. */
async function readServer(token: string, serverId: number) {
	const body = await require2xx(token, "GET", `/servers/${serverId}`);
	return (
		(body as { server?: { status?: string; firewalls?: { id?: number }[] } })
			.server ?? {}
	);
}

/**
 * Waits until Hetzner itself says the change happened. Every one of these is an action Hetzner
 * carries out after answering, so a control that returned before it finished would hand a test a
 * world it only asked for, and the test would read the state it was trying to change.
 */
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

/**
 * Stops one server at Hetzner itself, which is what the fake's own control stands in for. A test
 * that says somebody stopped a server in the console must mean it when the console is real.
 */
export async function stopHetznerServer(token: string, serverId: number) {
	await require2xx(token, "POST", `/servers/${serverId}/actions/poweroff`);
	await waitUntil(token, serverId, (server) => server.status === "off", "stop");
}

/**
 * Takes every firewall off one server at Hetzner itself. The rules a server is behind are the
 * project's, so which firewall it is belongs to the project, not to this run: whatever is on the
 * server comes off.
 */
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
			// biome-ignore lint/style/useNamingConvention: the Hetzner Cloud API names these fields
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
