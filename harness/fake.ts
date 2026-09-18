import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { ContractChecker } from "../contracts/check";
import { registerCleanup } from "./cleanup";

/**
 * What every fake of an outside system shares: it listens on this machine alone, records what
 * Composery sent, answers as the system would, and holds both halves of the exchange to that
 * system's own published description. It never decides whether a test passes.
 *
 * A fake can also produce outcomes the real system cannot be asked for, such as a reply that
 * never arrives, so a test can make a path fail on purpose.
 */

const loopbackHost = "127.0.0.1";
const apiPrefixPattern = /^\/v1\//;

/** What Composery sent, so a test can count requests or read a body. */
export type FakeRequest = Readonly<{
	method: string;
	path: string;
	headers: Readonly<Record<string, string | undefined>>;
	body: unknown;
}>;

/** A reply as the system would send it. A null body means no content. */
export type FakeReply = Readonly<{ status: number; body: unknown }>;

/**
 * `answer` acts as the system would. `lose` acts too, and then drops the connection, so Composery
 * learns nothing about a request that took effect. A status and body is a refusal.
 */
export type FakeOutcome = "answer" | "lose" | FakeReply;

/**
 * Which requests a count or a scripted outcome is about. One fake and one worker serve the whole
 * run, so a match that names only a method and a path also catches every other test's servers.
 * Name what belongs to the test: its server's ID in the path, or its allocation in the body.
 */
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
	/** The loopback address to give the setting that points at this system. */
	url: string;
	/** Every request in order, oldest first. */
	requests: () => readonly FakeRequest[];
	/** Every way this run disagreed with the system's description of itself. */
	problems: () => readonly string[];
	/** Anything else this fake noticed, such as a promise the system's own client makes. */
	noteProblem: (problem: string) => void;
	countRequests: (match: FakeMatch) => number;
	/**
	 * Applies once, to the next request that matches, and returns whether it has applied yet. A test
	 * must check that: a scripted failure that never happens leaves the ordinary path, which usually
	 * passes the same assertions, and the test then proves nothing while looking green.
	 */
	scriptOnce: (match: FakeMatch, outcome: FakeOutcome) => () => boolean;
	stop: () => void;
}>;

export type FakeOptions = Readonly<{
	/** The system's name, for the message when the fake cannot start. */
	system: string;
	checker: ContractChecker;
	answer: (request: FakeRequest) => FakeReply;
	/**
	 * The real system, when a run was given its credentials. Every request is passed on and every
	 * answer is the system's own, so the same tests ask the same questions of the thing itself:
	 * what it accepts, what it sends back, and how long it takes. What a test scripts still
	 * happens, which is how a reply that never arrives is a real one that never arrives.
	 */
	forward?: (request: FakeRequest) => Promise<FakeReply>;
	/** Anything else this system promises about a request, such as a version header. */
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
		response.writeHead(reply.status);
		response.end();
		return;
	}
	response.writeHead(reply.status, { "content-type": "application/json" });
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
		// Composery calls the same paths it calls at the system, under the same prefix. What is
		// left is spelled the way the description spells it, leading slash and all.
		const path = (incoming.url ?? "").replace(apiPrefixPattern, "/");
		const request: FakeRequest = {
			method,
			path,
			headers: incoming.headers as Record<string, string | undefined>,
			body,
		};
		requests.push(request);
		// Composery's own request is held to the same description as the reply.
		options.checker.listRequestProblems(method, path, body);
		for (const problem of options.check?.(request) ?? []) {
			options.checker.noteProblem(problem);
		}

		const outcome = takeScript(request);
		if (outcome === "lose") {
			// The system did the work; the answer never arrives. Composery must not assume it failed.
			await answer(request);
			incoming.socket.destroy();
			return;
		}
		if (outcome !== "answer") {
			send(response, outcome);
			return;
		}
		const reply = await answer(request);
		// The system's own description decides whether it could have sent this.
		options.checker.listReplyProblems(
			method,
			path,
			reply.status,
			reply.body ?? {},
		);
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
