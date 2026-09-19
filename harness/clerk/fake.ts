import { clerkApiVersion, clerkContract } from "../../contracts/clerk";

import { type Fake, type FakeReply, startFake } from "../fake";
import { getClerkSecret, toClerkForward } from "./real";
import {
	type ClerkUser,
	toCountReply,
	toUserEvent,
	toUserReply,
} from "./replies";

const httpOk = 200;
const httpNotFound = 404;
const userPathPattern = /^\/users\/([^/?]+)/;
const listPath = "/users";
const countPath = "/users/count";
const keysPath = "/jwks";

export type ClerkFake = Fake &
	Readonly<{
		isFake: boolean;
		setUser: (user: ClerkUser) => void;
		removeUser: (id: string) => void;
		setKeys: (keys: unknown) => void;
		toEvent: (
			type: "user.created" | "user.updated" | "user.deleted",
			user: ClerkUser,
		) => string;
	}>;

function notFound(): FakeReply {
	return {
		status: httpNotFound,
		body: {
			// biome-ignore-start lint/style/useNamingConvention: external field names
			errors: [
				{
					message: "not found",
					long_message: "No user was found with that identifier.",
					code: "resource_not_found",
				},
			],
			clerk_trace_id: "trace_composery_test",
			// biome-ignore-end lint/style/useNamingConvention: external field names
		},
	};
}

/** Fake replies are checked against Clerk's contract; real mode forwards instead. */
export async function startClerkFake(): Promise<ClerkFake> {
	const users = new Map<string, ClerkUser>();
	let keys: unknown = { keys: [] };

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

	const secret = getClerkSecret();
	const fake = await startFake({
		system: "Clerk",
		checker: clerkContract,
		answer: (request) => answer(request.method, request.path),
		...(secret === null ? {} : { forward: toClerkForward(secret) }),
		check: (request) => {
			const sent = request.headers["clerk-api-version"];
			return sent === clerkApiVersion
				? []
				: [
						`Clerk's client asks for API version ${String(sent)}, and contracts/clerk.ts pins ${clerkApiVersion}. Move the pin, then run bun contracts.`,
					];
		},
	});

	const onlyFake = (what: string) => {
		if (secret !== null) {
			throw new Error(
				`This run meets Clerk itself, so it cannot ${what}. Run this test with CLERK_MODE=fake.`,
			);
		}
	};

	return {
		...fake,
		isFake: secret === null,
		setKeys: (published) => {
			onlyFake("publish signing keys of its own");
			keys = published;
		},
		setUser: (user) => {
			onlyFake("put an account there by hand");
			users.set(user.id, user);
		},
		removeUser: (id) => {
			onlyFake("take an account away by hand");
			users.delete(id);
		},
		toEvent: (type, user) => {
			const event = toUserEvent(type, user);
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

export function useClerkFake() {
	started ??= startClerkFake();
	return started;
}
