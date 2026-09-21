import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { ContractChecker } from "../contracts/check";
import { registerCleanup } from "./cleanup";

const loopbackHost = "127.0.0.1";
const apiPrefixPattern = /^\/v1\//;

export type FakeRequest = Readonly<{
	method: string;
	path: string;
	headers: Readonly<Record<string, string | undefined>>;
	body: unknown;
}>;

export type FakeReply = Readonly<{
	status: number;
	body: unknown;
	headers?: Readonly<Record<string, string>>;
}>;

/** What a fake does with one request instead of answering it as it normally would. */
export type FakeOutcome =
	| Readonly<{ kind: "answer" }>
	/** The answer takes effect, but the caller never sees it and must reconcile. */
	| Readonly<{ kind: "lose" }>
	| Readonly<{ kind: "reply"; reply: FakeReply }>
	/** A deliberately malformed provider reply, so the contract cannot check it. */
	| Readonly<{ kind: "uncheckedReply"; reply: FakeReply }>
	/** A provider reply held long enough to overlap another action. */
	| Readonly<{ kind: "delay"; delayMs: number }>
	/** The answer as it would be, carrying headers a test needs it to state. */
	| Readonly<{
			kind: "extraHeaders";
			headers: Readonly<Record<string, string>>;
	  }>;

/** Matches must include a test-owned path or body identity. */
export type FakeMatch = Readonly<{
	method: string;
	path: RegExp;
	body?: (body: unknown) => boolean;
}>;

function isMatch(match: FakeMatch, request: FakeRequest) {
	// A global or sticky expression keeps lastIndex between calls. Matches are
	// predicates, so that state must never make the same request change result.
	match.path.lastIndex = 0;
	const pathMatches = match.path.test(request.path);
	match.path.lastIndex = 0;
	return (
		match.method === request.method &&
		pathMatches &&
		(match.body?.(request.body) ?? true)
	);
}

export type Fake = Readonly<{
	url: string;
	requests: () => readonly FakeRequest[];
	problems: () => readonly string[];
	noteProblem: (problem: string) => void;
	countRequests: (match: FakeMatch) => number;
	/** Applies to the next match and reports whether it fired. */
	scriptOnce: (match: FakeMatch, outcome: FakeOutcome) => () => boolean;
	stop: () => Promise<void>;
}>;

export type FakeOptions = Readonly<{
	system: string;
	checker: ContractChecker;
	answer: (request: FakeRequest) => FakeReply;
	/** Optional real-service forwarding for integration runs. */
	forward?: (request: FakeRequest) => Promise<FakeReply>;
	/** Sees every reply, including scripted replies. */
	observe?: (reply: FakeReply) => void;
	check?: (request: FakeRequest) => readonly string[];
}>;

function readBody(request: IncomingMessage) {
	return new Promise<unknown>((resolve) => {
		const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => chunks.push(chunk));
		request.on("end", () => {
			if (chunks.length === 0) {
				resolve(undefined);
				return;
			}
			try {
				resolve(JSON.parse(Buffer.concat(chunks).toString()));
			} catch {
				resolve(undefined);
			}
		});
	});
}

function toHeaders(headers: IncomingMessage["headers"]) {
	return Object.fromEntries(
		Object.entries(headers).map(([name, value]) => [
			name,
			Array.isArray(value) ? value.join(", ") : value,
		]),
	) as Record<string, string | undefined>;
}

function send(response: ServerResponse, reply: FakeReply) {
	if (reply.body === null) {
		response.writeHead(reply.status, { ...reply.headers });
		response.end();
		return;
	}
	response.writeHead(reply.status, {
		"content-type": "application/json",
		...reply.headers,
	});
	response.end(JSON.stringify(reply.body));
}

export async function startFake(options: FakeOptions): Promise<Fake> {
	const requests: FakeRequest[] = [];
	const scripts: (FakeMatch & {
		outcome: FakeOutcome;
		markFired: () => void;
	})[] = [];

	const takeScript = (request: FakeRequest): FakeOutcome => {
		const index = scripts.findIndex((candidate) => isMatch(candidate, request));
		const [script] = index === -1 ? [] : scripts.splice(index, 1);
		if (script === undefined) {
			return { kind: "answer" };
		}
		script.markFired();
		return script.outcome;
	};

	const answer = async (request: FakeRequest) =>
		options.forward === undefined
			? options.answer(request)
			: await options.forward(request);

	const checkReply = (request: FakeRequest, reply: FakeReply) => {
		for (const problem of options.checker.listReplyProblems(
			request.method,
			request.path,
			reply.status,
			reply.body,
		)) {
			options.checker.noteProblem(problem);
		}
	};

	const sendChecked = (
		request: FakeRequest,
		response: ServerResponse,
		reply: FakeReply,
	) => {
		checkReply(request, reply);
		options.observe?.(reply);
		send(response, reply);
	};

	const handleOutcome = async (
		request: FakeRequest,
		incoming: IncomingMessage,
		response: ServerResponse,
		outcome: FakeOutcome,
	) => {
		switch (outcome.kind) {
			case "answer":
				sendChecked(request, response, await answer(request));
				return;
			case "extraHeaders": {
				const answered = await answer(request);
				sendChecked(request, response, {
					...answered,
					headers: { ...answered.headers, ...outcome.headers },
				});
				return;
			}
			case "lose": {
				// The request may have succeeded; the caller must reconcile.
				checkReply(request, await answer(request));
				incoming.socket.destroy();
				return;
			}
			case "delay": {
				const delayed = await answer(request);
				await Bun.sleep(outcome.delayMs);
				sendChecked(request, response, delayed);
				return;
			}
			case "reply":
				sendChecked(request, response, outcome.reply);
				return;
			case "uncheckedReply":
				options.observe?.(outcome.reply);
				send(response, outcome.reply);
				return;
		}
	};

	const handle = async (
		incoming: IncomingMessage,
		response: ServerResponse,
		body: unknown,
	) => {
		const method = incoming.method ?? "GET";
		const path = (incoming.url ?? "").replace(apiPrefixPattern, "/");
		const request: FakeRequest = {
			method,
			path,
			headers: toHeaders(incoming.headers),
			body,
		};
		requests.push(request);
		options.checker.listRequestProblems(method, path, body);
		for (const problem of options.check?.(request) ?? []) {
			options.checker.noteProblem(problem);
		}

		await handleOutcome(request, incoming, response, takeScript(request));
	};

	const server = createServer((incoming, response) => {
		void readBody(incoming)
			.then((body) => handle(incoming, response, body))
			.catch(() => incoming.socket.destroy());
	});
	let stopped: Promise<void> | undefined;
	const stop = () => {
		if (stopped !== undefined) {
			return stopped;
		}
		stopped = new Promise<void>((resolve, reject) => {
			server.closeAllConnections();
			server.close((error) => {
				if (
					error !== undefined &&
					(error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING"
				) {
					reject(error);
					return;
				}
				resolve();
			});
		});
		return stopped;
	};
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, loopbackHost, () => {
			server.removeListener("error", reject);
			resolve();
		});
	});
	registerCleanup(stop);
	const address = server.address();
	if (typeof address !== "object" || address === null) {
		await stop();
		throw new Error(`The ${options.system} fake did not take a port.`);
	}

	return {
		url: `http://${loopbackHost}:${address.port}`,
		requests: () => requests,
		problems: () => options.checker.listProblems(),
		noteProblem: options.checker.noteProblem,
		countRequests: (match) =>
			requests.filter((request) => isMatch(match, request)).length,
		scriptOnce: (match, outcome) => {
			let fired = false;
			scripts.push({
				...match,
				outcome,
				markFired: () => {
					fired = true;
				},
			});
			return () => fired;
		},
		stop,
	};
}
