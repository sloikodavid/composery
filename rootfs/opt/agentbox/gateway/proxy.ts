import {
	request as httpRequest,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import type { GatewayProxyTarget } from "./routing.ts";

export interface GatewayProxy {
	http(
		request: IncomingMessage,
		response: ServerResponse,
		url: URL,
		target: GatewayProxyTarget,
	): void;
	upgrade(
		request: IncomingMessage,
		socket: Duplex,
		head: Buffer,
		url: URL,
		target: GatewayProxyTarget,
	): void;
}

export function createGatewayProxy(options: {
	readonly codeServerOrigin: URL;
	readonly proxyToCodeServerTimeoutMs: number;
	readonly log: (message: string) => void;
}): GatewayProxy {
	const origin = options.codeServerOrigin;

	return {
		http(
			request: IncomingMessage,
			response: ServerResponse,
			url: URL,
			target: GatewayProxyTarget,
		): void {
			const proxyRequest = httpRequest(
				{
					host: origin.hostname,
					port: originPort(origin),
					path: `${target.path}${url.search}`,
					method: request.method,
					headers: target.headers,
				},
				(proxyResponse) => {
					response.writeHead(
						proxyResponse.statusCode ?? 502,
						filterHeadersForResponse(proxyResponse.headers),
					);
					proxyResponse.pipe(response);
				},
			);

			proxyRequest.on("error", (error) => {
				options.log(`proxy failed: ${String(error)}`);
				if (!response.headersSent) {
					sendText(response, 502, "bad gateway\n");
				} else {
					response.destroy();
				}
			});

			request.pipe(proxyRequest);
		},

		upgrade(
			request: IncomingMessage,
			socket: Duplex,
			head: Buffer,
			url: URL,
			target: GatewayProxyTarget,
		): void {
			const headers = {
				...target.headers,
				connection: "upgrade",
				upgrade: request.headers.upgrade ?? "websocket",
			};
			let settled = false;
			const failUpgrade = (): void => {
				if (settled) {
					return;
				}
				settled = true;
				writeUpgradeError(socket, 502, "Bad Gateway", "bad gateway\n");
			};

			const proxyRequest = httpRequest(
				{
					host: origin.hostname,
					port: originPort(origin),
					path: `${target.path}${url.search}`,
					method: request.method,
					headers,
				},
				(proxyResponse) => {
					if (settled) {
						proxyResponse.resume();
						return;
					}
					settled = true;
					writeRawResponseHead(
						socket,
						proxyResponse.httpVersion,
						proxyResponse.statusCode ?? 502,
						proxyResponse.statusMessage ?? "Bad Gateway",
						filterHeadersForResponse(proxyResponse.headers),
					);
					proxyResponse.pipe(socket);
				},
			);

			proxyRequest.setTimeout(options.proxyToCodeServerTimeoutMs, () => {
				failUpgrade();
				proxyRequest.destroy();
			});
			proxyRequest.on("upgrade", (proxyResponse, proxySocket, proxyHead) => {
				if (settled) {
					proxySocket.destroy();
					return;
				}
				settled = true;
				writeRawResponseHead(
					socket,
					proxyResponse.httpVersion,
					proxyResponse.statusCode ?? 101,
					proxyResponse.statusMessage ?? "Switching Protocols",
					proxyResponse.headers,
				);
				if (proxyHead.length > 0) {
					socket.write(proxyHead);
				}
				if (head.length > 0) {
					proxySocket.write(head);
				}
				proxySocket.pipe(socket);
				socket.pipe(proxySocket);
				proxySocket.on("error", () => socket.destroy());
				socket.on("error", () => proxySocket.destroy());
			});

			proxyRequest.on("error", () => {
				failUpgrade();
			});
			proxyRequest.end();
		},
	};
}

function originPort(origin: URL): number {
	if (origin.port) {
		return Number(origin.port);
	}
	return origin.protocol === "https:" ? 443 : 80;
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

const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

function filterHeadersForResponse(
	headers: IncomingMessage["headers"],
): Record<string, string | string[]> {
	const filtered: Record<string, string | string[]> = {};
	const connectionTokens = new Set(
		String(
			Array.isArray(headers.connection)
				? headers.connection.join(",")
				: (headers.connection ?? ""),
		)
			.split(",")
			.map((token) => token.trim().toLowerCase())
			.filter(Boolean),
	);
	for (const [name, value] of Object.entries(headers)) {
		const lowerName = name.toLowerCase();
		if (
			!HOP_BY_HOP_HEADERS.has(lowerName) &&
			!connectionTokens.has(lowerName) &&
			value !== undefined
		) {
			filtered[name] = value;
		}
	}
	return filtered;
}

export function writeUpgradeError(
	socket: Duplex,
	statusCode: number,
	statusMessage: string,
	body: string,
): void {
	if (socket.destroyed || socket.writableEnded) {
		return;
	}
	socket.write(
		`HTTP/1.1 ${statusCode} ${statusMessage}\r\n` +
			"Connection: close\r\n" +
			"Content-Type: text/plain; charset=utf-8\r\n" +
			`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n` +
			body,
	);
	socket.end();
}

function writeRawResponseHead(
	socket: Duplex,
	httpVersion: string,
	statusCode: number,
	statusMessage: string,
	headers: IncomingMessage["headers"],
): void {
	socket.write(`HTTP/${httpVersion} ${statusCode} ${statusMessage}\r\n`);
	for (const [name, value] of Object.entries(headers)) {
		for (const item of Array.isArray(value) ? value : [value]) {
			if (item !== undefined) {
				socket.write(`${name}: ${sanitizeHeaderValue(item)}\r\n`);
			}
		}
	}
	socket.write("\r\n");
}

function sanitizeHeaderValue(value: string): string {
	return value.replaceAll(/[\r\n]/g, " ");
}
