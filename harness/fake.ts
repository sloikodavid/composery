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

/** "lose" means the request may have taken effect without a response. */
export type FakeOutcome =
	| "answer"
	| "lose"
	| FakeReply
	| Readonly<{ headers: Readonly<Record<string, string>> }>;

/** Matches must include a test-owned path or body identity. */
export type FakeMatch = Readonly<{
	method: string;
	path: RegExp;
	body?: (body: unknown) => boolean;
}>;

function isMatch(match: FakeMatch, request: FakeRequest) {
	return (
		match.method === request.method &&
		match.path.test(request.path) &&
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
	stop: () => void;
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
			return "answer";
		}
		script.markFired();
		return script.outcome;
	};

	const answer = async (request: FakeRequest) =>
		options.forward === undefined
			? options.answer(request)
			: await options.forward(request);

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
			headers: incoming.headers as Record<string, string | undefined>,
			body,
		};
		requests.push(request);
		options.checker.listRequestProblems(method, path, body);
		for (const problem of options.check?.(request) ?? []) {
			options.checker.noteProblem(problem);
		}

		const outcome = takeScript(request);
		if (outcome === "lose") {
			// The request may have succeeded; the caller must reconcile.
			await answer(request);
			incoming.socket.destroy();
			return;
		}
		if (outcome !== "answer" && "status" in outcome) {
			options.observe?.(outcome);
			send(response, outcome);
			return;
		}
		const answered = await answer(request);
		const reply =
			outcome === "answer"
				? answered
				: {
						...answered,
						headers: { ...answered.headers, ...outcome.headers },
					};
		options.checker.listReplyProblems(
			method,
			path,
			reply.status,
			reply.body ?? {},
		);
		options.observe?.(reply);
		send(response, reply);
	};

	const server = createServer((incoming, response) => {
		void readBody(incoming).then(
			async (body) => await handle(incoming, response, body),
		);
	});
	const stop = () => {
		server.closeAllConnections();
		server.close();
	};
	await new Promise<void>((resolve) => {
		server.listen(0, loopbackHost, resolve);
	});
	registerCleanup(stop);
	const address = server.address();
	if (typeof address !== "object" || address === null) {
		stop();
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
