import { clerkApiVersion, clerkContract } from "../../contracts/clerk";

import { type Fake, type FakeReply, startFake } from "../fake";
import {
	type ClerkUser,
	toCountReply,
	toUserEvent,
	toUserReply,
} from "./replies";

/**
 * A fake for Clerk's backend API. Clerk holds the accounts, so a test puts one here and Composery
 * reads it back through the path it uses for real. Clerk's own client deserializes a reply without
 * checking it, so Clerk's published description is what decides whether a reply is one Clerk could
 * have sent.
 */

const httpOk = 200;
const httpNotFound = 404;
const userPathPattern = /^\/users\/([^/?]+)/;
const listPath = "/users";
const countPath = "/users/count";
const keysPath = "/jwks";

export type ClerkFake = Fake &
	Readonly<{
		/** Adds or replaces one account, as if somebody signed up. */
		setUser: (user: ClerkUser) => void;
		/** Removes one account, as if it were deleted at Clerk. */
		removeUser: (id: string) => void;
		/**
		 * The signing keys Clerk publishes for this instance. Composery compares them with the ones
		 * the tokens are signed by before it believes that an account is gone, so a test that makes
		 * the two disagree is a deployment whose secret key belongs to another Clerk instance.
		 */
		setKeys: (keys: unknown) => void;
		/** The body Clerk would sign for an account, in the shape Clerk describes. */
		toEvent: (
			type: "user.created" | "user.updated" | "user.deleted",
			user: ClerkUser,
		) => string;
	}>;

function notFound(): FakeReply {
	return {
		status: httpNotFound,
		body: {
			// biome-ignore-start lint/style/useNamingConvention: Clerk names these fields
			errors: [
				{
					message: "not found",
					long_message: "No user was found with that identifier.",
					code: "resource_not_found",
				},
			],
			clerk_trace_id: "trace_composery_test",
			// biome-ignore-end lint/style/useNamingConvention: Clerk names these fields
		},
	};
}

export async function startClerkFake(): Promise<ClerkFake> {
	const users = new Map<string, ClerkUser>();
	let keys: unknown = { keys: [] };

	// Clerk filters a list by the accounts asked for, and pages it. A fake that answered with
	// everything would hide the code that decides an account is gone.
	const select = (query: URLSearchParams) => {
		const wanted = query.getAll("user_id");
		const all = [...users.values()].filter(
			(user) => wanted.length === 0 || wanted.includes(user.id),
		);
		const offset = Number(query.get("offset") ?? 0);
		const limit = Number(query.get("limit") ?? all.length);
		return { all, page: all.slice(offset, offset + limit) };
	};

	const answer = (method: string, path: string): FakeReply => {
		const [route, rawQuery] = path.split("?");
		const query = new URLSearchParams(rawQuery ?? "");
		if (method !== "GET") {
			return notFound();
		}
		if (route === keysPath) {
			return { status: httpOk, body: keys };
		}
		if (route === countPath) {
			return { status: httpOk, body: toCountReply(select(query).all.length) };
		}
		if (route === listPath) {
			return { status: httpOk, body: select(query).page.map(toUserReply) };
		}
		const found = userPathPattern.exec(route ?? "");
		const user = found === null ? undefined : users.get(found[1] ?? "");
		return user === undefined
			? notFound()
			: { status: httpOk, body: toUserReply(user) };
	};

	const fake = await startFake({
		system: "Clerk",
		checker: clerkContract,
		answer: (request) => answer(request.method, request.path),
		// Clerk's own client states which version of the API it speaks. When an upgrade changes it,
		// the pinned description is no longer the one we are held to.
		check: (request) => {
			const sent = request.headers["clerk-api-version"];
			return sent === clerkApiVersion
				? []
				: [
						`Clerk's client asks for API version ${String(sent)}, and contracts/clerk.ts pins ${clerkApiVersion}. Move the pin, then run bun contracts.`,
					];
		},
	});

	return {
		...fake,
		setKeys: (published) => {
			keys = published;
		},
		setUser: (user) => {
			users.set(user.id, user);
		},
		removeUser: (id) => {
			users.delete(id);
		},
		toEvent: (type, user) => {
			const event = toUserEvent(type, user);
			// The body a test signs is held to Clerk's description of that event, so a forged event
			// cannot be a shape Clerk never sends.
			for (const problem of clerkContract.listRequestProblems(
				"POST",
				type,
				event,
			)) {
				fake.noteProblem(problem);
			}
			return JSON.stringify(event);
		},
	};
}

let started: Promise<ClerkFake> | undefined;

/** One fake for the whole run, because the deployment holds its address. */
export function useClerkFake() {
	started ??= startClerkFake();
	return started;
}
