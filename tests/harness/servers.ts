import { randomBytes } from "node:crypto";
import type { ConvexHttpClient } from "convex/browser";
import { api, internal } from "../../convex/_generated/api";
import type { ConvexBackend } from "./convex-backend";

const suffixBytes = 6;
/** Room enough that no test waits on another test's servers. */
const quotaLimit = 10;

/** A signed-in account with room for servers, at its own level and at the deployment's. */
export async function createServerOwner(backend: ConvexBackend) {
	const account = await backend.createAccount();
	const client = backend.createClient(account.id);
	const user = await client.query(api.users.getCurrent, {});
	if (user === null) {
		throw new Error("The owner did not sync.");
	}
	await backend.runAsAdmin(internal.quotas.setForUser, {
		userId: user._id,
		kind: "server",
		limit: quotaLimit,
	});
	await backend.runAsAdmin(internal.quotas.setForDeployment, {
		kind: "server",
		limit: quotaLimit,
	});
	return client;
}

/** Asks for a server under a name no other test uses, and returns it once it can be read. */
export async function createServer(client: ConvexHttpClient) {
	const name = `test-${randomBytes(suffixBytes).toString("hex")}`;
	const created = await client.mutation(api.servers.lifecycle.create, {
		name,
		requestId: `request-${randomBytes(suffixBytes).toString("hex")}`,
	});
	if (!created.ok) {
		throw new Error(`Creating the server failed: ${created.code}`);
	}
	const server = await client.query(api.servers.names.getByName, { name });
	if (server === null) {
		throw new Error("The created server is not readable.");
	}
	return server._id;
}
