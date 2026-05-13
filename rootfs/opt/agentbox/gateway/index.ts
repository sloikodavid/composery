import {
	createServer as createHttpServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { parseConfig, type AgentboxConfig } from "../config.ts";
import {
	CODE_SERVER_DEFAULTS,
	GATEWAY_DEFAULTS,
	PERSISTENCE_DEFAULTS,
} from "../defaults.ts";
import { createGatewayProxy } from "./proxy.ts";
import { writeUpgradeError } from "./proxy.ts";
import {
	planGatewayRequest,
	planGatewayUpgrade,
	type GatewayRequestPlan,
	type GatewayUpgradePlan,
} from "./routing.ts";
import {
	createReadinessMonitor,
	type GatewayHealth,
	type GatewayReadinessTimings,
} from "./readiness.ts";

export { createPublicAddress, type PublicAddress } from "./public-address.ts";
export {
	type GatewayHealth,
	type GatewayHealthCheck,
	type GatewayReadinessTimings,
} from "./readiness.ts";

export interface GatewayServer {
	readonly config: AgentboxConfig;
	readonly server: Server;
	start(): Promise<void>;
	stop(): Promise<void>;
	health(): GatewayHealth;
}

export interface GatewayTimings extends GatewayReadinessTimings {
	readonly proxyToCodeServerTimeoutMs: number;
}

export interface GatewayServerOptions {
	readonly codeServerOrigin?: URL;
	readonly persistenceHeartbeatPath?: string;
	readonly timings?: Partial<GatewayTimings>;
	readonly now?: () => Date;
	readonly log?: (message: string) => void;
}

export function createGatewayServer(
	config: AgentboxConfig,
	options: GatewayServerOptions = {},
): GatewayServer {
	const timings = gatewayTimings(options.timings);
	const codeServerOrigin = new URL(
		(
			options.codeServerOrigin ?? new URL(CODE_SERVER_DEFAULTS.origin)
		).toString(),
	);
	const persistenceHeartbeatPath =
		options.persistenceHeartbeatPath ?? PERSISTENCE_DEFAULTS.heartbeatPath;
	const logMessage = options.log ?? log;
	const readiness = createReadinessMonitor({
		version: config.buildVersion,
		codeServerOrigin,
		persistenceHeartbeatPath,
		timings,
		log: logMessage,
		onReady: () => logReady(config, logMessage),
		...(options.now ? { now: options.now } : {}),
	});
	const proxy = createGatewayProxy({
		codeServerOrigin,
		proxyToCodeServerTimeoutMs: timings.proxyToCodeServerTimeoutMs,
		log: logMessage,
	});
	const sockets = new Set<Socket>();

	const server = config.tls?.fileContents
		? createHttpsServer(
				{
					key: config.tls.fileContents.key,
					cert: config.tls.fileContents.cert,
				},
				(request, response) => handleRequest(request, response),
			)
		: createHttpServer((request, response) => handleRequest(request, response));

	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});

	server.on("upgrade", (request, socket, head) =>
		handleUpgrade(request, socket, head),
	);

	async function start(): Promise<void> {
		await readiness.start();
		try {
			await listen(server, config.port, config.bindAddress);
		} catch (error) {
			readiness.stop();
			throw error;
		}
		logMessage(`listening on ${config.bindAddress}:${config.port}`);
	}

	async function stop(): Promise<void> {
		readiness.stop();
		if (!server.listening) {
			destroySockets();
			return;
		}
		await new Promise<void>((resolve, reject) => {
			server.close((error) => (error ? reject(error) : resolve()));
			destroySockets();
		});
	}

	function health(): GatewayHealth {
		return readiness.health();
	}

	function destroySockets(): void {
		for (const socket of sockets) {
			socket.destroy();
		}
	}

	function handleRequest(
		request: IncomingMessage,
		response: ServerResponse,
	): void {
		try {
			const url = parseRequestUrl(request);
			const plan = planGatewayRequest({
				config,
				url,
				headers: request.headers,
				ready: health().ready,
				wantsHtml: acceptsHtml(request),
			});
			sendPlannedResponse({ plan, request, response, url });
		} catch (error) {
			logMessage(`request failed: ${String(error)}`);
			sendText(response, 500, "internal server error\n");
		}
	}

	function sendPlannedResponse(input: {
		readonly plan: GatewayRequestPlan;
		readonly request: IncomingMessage;
		readonly response: ServerResponse;
		readonly url: URL;
	}): void {
		switch (input.plan.type) {
			case "healthz":
			case "readiness":
				sendJson(input.response, input.plan.statusCode, health());
				return;
			case "metrics":
				sendText(
					input.response,
					200,
					`agentbox_ready ${health().ready ? 1 : 0}\n`,
				);
				return;
			case "notFound":
				sendText(input.response, 404, "not found\n");
				return;
			case "startingPage":
				input.response.setHeader("Retry-After", "1");
				sendStartingPage(input.response, input.plan.readinessUrlPath);
				return;
			case "startingText":
				input.response.setHeader("Retry-After", "1");
				sendText(input.response, 503, "Agentbox is starting\n");
				return;
			case "proxy":
				proxy.http(input.request, input.response, input.url, input.plan.target);
				return;
		}
	}

	function handleUpgrade(
		request: IncomingMessage,
		socket: Duplex,
		head: Buffer,
	): void {
		const url = parseRequestUrl(request);
		const plan = planGatewayUpgrade({
			config,
			url,
			headers: request.headers,
			ready: health().ready,
		});
		handlePlannedUpgrade({ plan, request, socket, head, url });
	}

	function handlePlannedUpgrade(input: {
		readonly plan: GatewayUpgradePlan;
		readonly request: IncomingMessage;
		readonly socket: Duplex;
		readonly head: Buffer;
		readonly url: URL;
	}): void {
		if (input.plan.type === "notReady") {
			writeUpgradeError(
				input.socket,
				503,
				"Service Unavailable",
				"Agentbox is starting\n",
			);
			return;
		}
		if (input.plan.type === "notFound") {
			writeUpgradeError(input.socket, 404, "Not Found", "not found\n");
			return;
		}
		proxy.upgrade(
			input.request,
			input.socket,
			input.head,
			input.url,
			input.plan.target,
		);
	}

	return { config, server, start, stop, health };
}

function gatewayTimings(
	overrides: Partial<GatewayTimings> = {},
): GatewayTimings {
	return {
		readinessPollIntervalMs: GATEWAY_DEFAULTS.readinessPollIntervalMs,
		codeServerHealthTimeoutMs: GATEWAY_DEFAULTS.codeServerHealthTimeoutMs,
		proxyToCodeServerTimeoutMs: GATEWAY_DEFAULTS.proxyToCodeServerTimeoutMs,
		persistenceHeartbeatMaxAgeMs: PERSISTENCE_DEFAULTS.heartbeatMaxAgeMs,
		...overrides,
	};
}

function parseRequestUrl(request: IncomingMessage): URL {
	return new URL(request.url ?? "/", "http://agentbox.internal");
}

function sendJson(
	response: ServerResponse,
	statusCode: number,
	body: unknown,
): void {
	response.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
	});
	response.end(`${JSON.stringify(body)}\n`);
}

function sendText(
	response: ServerResponse,
	statusCode: number,
	body: string,
): void {
	response.writeHead(statusCode, {
		"content-type": "text/plain; charset=utf-8",
	});
	response.end(body);
}

function acceptsHtml(request: IncomingMessage): boolean {
	const accept = request.headers.accept;
	return (Array.isArray(accept) ? accept.join(",") : (accept ?? ""))
		.toLowerCase()
		.includes("text/html");
}

function sendStartingPage(
	response: ServerResponse,
	readinessUrlPath: string,
): void {
	const body = `<style>body{font-family:monospace;white-space:pre}</style>Agentbox is starting
<script>
const readinessUrlPath = ${JSON.stringify(readinessUrlPath)};
async function waitUntilReady() {
	try {
		if ((await fetch(readinessUrlPath, { cache: "no-store" })).ok) {
			location.reload();
			return;
		}
	} catch {}
	setTimeout(waitUntilReady, 1000);
}
waitUntilReady();
</script>
`;
	response.writeHead(503, {
		"cache-control": "no-store",
		"content-type": "text/html; charset=utf-8",
	});
	response.end(body);
}

function logReady(
	config: AgentboxConfig,
	logMessage: (message: string) => void,
): void {
	logMessage(`Agentbox is ready.\nURL:\n${config.publicUrl}`);
}

function log(message: string): void {
	console.log(`[agentbox-gateway] ${message}`);
}

async function listen(
	server: Server,
	port: number,
	bindAddress: string,
): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const cleanup = (): void => {
			server.off("error", onError);
			server.off("listening", onListening);
		};
		const onError = (error: Error): void => {
			cleanup();
			reject(error);
		};
		const onListening = (): void => {
			cleanup();
			resolve();
		};
		server.once("error", onError);
		server.listen(port, bindAddress, onListening);
	});
}

export async function startGatewayProcess(): Promise<void> {
	const gateway = createGatewayServer(parseConfig());
	process.on("SIGTERM", () => {
		gateway
			.stop()
			.then(() => process.exit(0))
			.catch(() => process.exit(1));
	});
	await gateway.start().catch((error: unknown) => {
		log(`startup failed: ${String(error)}`);
		process.exit(1);
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await startGatewayProcess();
}
