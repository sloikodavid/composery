import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { registerCleanup } from "./cleanup";

/**
 * A fake for Clerk's backend API. Clerk's own SDK reads these replies, so the SDK decides whether
 * a reply is shaped the way Clerk shapes one: a field of the wrong name or type fails there, in
 * the code that runs in production. A test puts users in, and Composery reads them back through
 * the same path it uses for real.
 */

const httpOk = 200;
const httpNotFound = 404;
const userPathPattern = /^\/v1\/users\/([^/?]+)/;
const listPathPattern = /^\/v1\/users(\?|$)/;

/** What a test says a Clerk account holds. Clerk's own field names, because this answers as Clerk. */
export type ClerkUser = Readonly<{
	id: string;
	username: string;
	email: string;
	imageUrl: string;
}>;

export type ClerkFake = Readonly<{
	/** The loopback address to give `CLERK_API_URL`. */
	url: string;
	/** Adds or replaces one account, as if somebody signed up. */
	setUser: (user: ClerkUser) => void;
	/** Removes one account, as if it were deleted at Clerk. */
	removeUser: (id: string) => void;
	stop: () => void;
}>;

function toUserReply(user: ClerkUser) {
	// biome-ignore-start lint/style/useNamingConvention: Clerk names these fields
	return {
		id: user.id,
		object: "user",
		username: user.username,
		first_name: null,
		last_name: null,
		image_url: user.imageUrl,
		has_image: true,
		primary_email_address_id: `idn_${user.id}`,
		email_addresses: [
			{
				id: `idn_${user.id}`,
				object: "email_address",
				email_address: user.email,
				verification: null,
				linked_to: [],
			},
		],
		phone_numbers: [],
		web3_wallets: [],
		external_accounts: [],
		public_metadata: {},
		private_metadata: {},
		unsafe_metadata: {},
		created_at: Date.now(),
		updated_at: Date.now(),
	};
	// biome-ignore-end lint/style/useNamingConvention: Clerk names these fields
}

async function startClerkFake(): Promise<ClerkFake> {
	const users = new Map<string, ClerkUser>();

	const handle = (request: IncomingMessage, response: ServerResponse) => {
		const requested = request.url ?? "";
		const send = (status: number, body: unknown) => {
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(body));
		};
		if (listPathPattern.test(requested)) {
			const listed = [...users.values()].map(toUserReply);
			// biome-ignore lint/style/useNamingConvention: Clerk names this field
			send(httpOk, { data: listed, total_count: listed.length });
			return;
		}
		const found = userPathPattern.exec(requested);
		const user = found === null ? undefined : users.get(found[1] ?? "");
		if (user === undefined) {
			send(httpNotFound, {
				errors: [{ message: "not found", code: "resource_not_found" }],
			});
			return;
		}
		send(httpOk, toUserReply(user));
	};

	const server = createServer(handle);
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
		throw new Error("The Clerk fake did not take a port.");
	}

	return {
		url: `http://127.0.0.1:${address.port}`,
		setUser: (user) => {
			users.set(user.id, user);
		},
		removeUser: (id) => {
			users.delete(id);
		},
		stop,
	};
}

let fake: Promise<ClerkFake> | undefined;

/** One fake for the whole run, because the deployment holds its address. */
export function useClerkFake() {
	fake ??= startClerkFake();
	return fake;
}
