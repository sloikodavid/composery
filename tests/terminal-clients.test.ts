import { describe, expect, test, vi } from "vitest";

import { TerminalDataFlowControl } from "../packages/ide/overlay/lib/vscode/src/vs/platform/terminal/common/terminalDataFlowControl.ts";
import {
	addedLines,
	evaluatePatchSnippets,
	readRepoFile
} from "./support/patchSource.js";

const patch = readRepoFile("packages/ide/patches/terminal-clients.diff");
const added = addedLines(patch);
const api = readRepoFile(
	"packages/ide/overlay/src/node/routes/api/terminals.ts"
);
const apiDocs = readRepoFile("docs/api.mdx");
const smoke = readRepoFile("scripts/smoke.mjs");

function declaration(source: string, marker: string): string {
	const start = source.indexOf(marker);
	if (start < 0) throw new Error(`Could not find ${marker}`);
	let depth = 0;
	for (let index = source.indexOf("{", start); index < source.length; index++) {
		if (source[index] === "{") depth++;
		else if (source[index] === "}" && --depth === 0) {
			return source.slice(start, index + 1);
		}
	}
	throw new Error(`Could not parse ${marker}`);
}

// The shipped registry methods, spliced into a stand-in that records what the
// pty would have been resized to. Nothing here restates their logic.
const registryMethods = [
	"registerClient",
	"unregisterClient",
	"resizeViewport",
	"activateViewport"
].map((name) => declaration(added, `\n\t${name}(`).trim());
const clientLookup = declaration(added, "\n\tprivate _client(").trim();

function clientRegistry(methods = registryMethods) {
	return evaluatePatchSnippets<{
		ClientRegistry: new () => {
			calls: Array<{ cols: number; rows: number }>;
			flow: string[];
			registerClient(id: string): void;
			unregisterClient(id: string): void;
			resizeViewport(
				id: string,
				viewport: { cols: number; rows: number }
			): void;
			activateViewport(
				id: string,
				viewport: { cols: number; rows: number }
			): void;
		};
	}>(
		[
			`interface IViewportDimensions { cols: number; rows: number; pixelWidth?: number; pixelHeight?: number }
			class ClientRegistry {
				private readonly _clients = new Map<string, { viewport?: IViewportDimensions; activation: number }>();
				private _activeClient: string | undefined;
				private _activations = 0;
				readonly calls: IViewportDimensions[] = [];
				readonly flow: string[] = [];
				private readonly _dataFlowControl = {
					register: (id: string) => this.flow.push('register:' + id),
					unregister: (id: string) => this.flow.push('unregister:' + id)
				};
				private _resize(viewport: IViewportDimensions): void { this.calls.push(viewport); }
				${methods.join("\n")}
				${clientLookup}
			}`
		],
		["ClientRegistry"]
	).ClientRegistry;
}

describe("terminal viewport arbitration", () => {
	test("only the active client resizes, and leaving restores the most recent one", () => {
		const Registry = clientRegistry();
		const registry = new Registry();
		registry.registerClient("phone");
		registry.registerClient("laptop");
		registry.resizeViewport("phone", { cols: 40, rows: 20 });
		registry.resizeViewport("laptop", { cols: 160, rows: 50 });
		expect(registry.calls).toEqual([]);

		registry.activateViewport("laptop", { cols: 160, rows: 50 });
		registry.activateViewport("phone", { cols: 40, rows: 20 });
		registry.resizeViewport("laptop", { cols: 150, rows: 45 });
		expect(registry.calls).toEqual([
			{ cols: 160, rows: 50 },
			{ cols: 40, rows: 20 }
		]);

		registry.unregisterClient("phone");
		expect(registry.calls.at(-1)).toEqual({ cols: 150, rows: 45 });
	});

	test("leaving never promotes a client that only ever reported a layout", () => {
		const Registry = clientRegistry();
		const registry = new Registry();
		registry.registerClient("phone");
		registry.registerClient("background");
		registry.resizeViewport("background", { cols: 200, rows: 60 });
		registry.activateViewport("phone", { cols: 40, rows: 20 });
		registry.unregisterClient("phone");
		expect(registry.calls).toHaveLength(1);

		// Mutation test: without the activation guard the background window's
		// geometry is imposed on a shell nobody is looking at.
		const MutatedRegistry = clientRegistry(
			registryMethods.map((method) =>
				method.replace("client.activation > 0 && ", "")
			)
		);
		const broken = new MutatedRegistry();
		broken.registerClient("phone");
		broken.registerClient("background");
		broken.resizeViewport("background", { cols: 200, rows: 60 });
		broken.activateViewport("phone", { cols: 40, rows: 20 });
		broken.unregisterClient("phone");
		expect(broken.calls).toHaveLength(2);
	});

	test("unknown clients fail instead of silently resizing", () => {
		const Registry = clientRegistry();
		const registry = new Registry();
		expect(() =>
			registry.resizeViewport("stranger", { cols: 80, rows: 24 })
		).toThrow("is not registered");
		expect(() =>
			registry.activateViewport("stranger", { cols: 80, rows: 24 })
		).toThrow("is not registered");
	});

	test("one registration covers the viewport and the flow control both", () => {
		// Two lifetimes for one client is how the previous split went wrong: the
		// data consumer was unregistered but never registered, so flow control was
		// armed only by the first acknowledgement to arrive.
		const Registry = clientRegistry();
		const registry = new Registry();
		registry.registerClient("phone");
		registry.registerClient("phone");
		registry.unregisterClient("phone");
		registry.unregisterClient("phone");
		expect(registry.flow).toEqual([
			"register:phone",
			"register:phone",
			"unregister:phone",
			"unregister:phone"
		]);
	});

	test("the PTY resize is deduplicated against the whole reported geometry", () => {
		expect(added).toContain(
			"this._dimensions.cols === dimensions.cols && this._dimensions.rows === dimensions.rows &&"
		);
		expect(added).toContain(
			"this._dimensions.pixelWidth === dimensions.pixelWidth && this._dimensions.pixelHeight === dimensions.pixelHeight"
		);
	});

	test("activation follows interaction capabilities, not device names", () => {
		expect(added).toContain(
			"@IHostService private readonly _hostService: IHostService"
		);
		// One pointer rule for mouse, pen and touch alike; wheel is separate only
		// because scrolling raises no pointerdown.
		expect(added).toContain(
			"dom.addDisposableListener(xterm.raw.element, dom.EventType.POINTER_DOWN, () => this._activateViewport()"
		);
		expect(added).toContain(
			"dom.addDisposableListener(xterm.raw.element, dom.EventType.MOUSE_WHEEL, () => this._activateViewport()"
		);
		expect(added).not.toContain("'touchstart'");
		expect(added).not.toContain("'mousedown'");
		expect(added).toContain("this._remoteTerminalChannel.activateViewport");
		expect(added).toContain("this._process?.activateViewport?.");
	});
});

describe("terminal data flow control", () => {
	test("the furthest-ahead client drives the counter, once per byte", () => {
		const acknowledge = vi.fn();
		const flow = new TerminalDataFlowControl(acknowledge);
		flow.register("browser");
		flow.register("api");
		flow.acceptData(8_192);

		// A stalled client must not hold the terminal for everyone watching it.
		flow.acknowledge("api", 8_192);
		expect(acknowledge).toHaveBeenCalledOnce();
		expect(acknowledge).toHaveBeenLastCalledWith(8_192);

		// And the one catching up later must not acknowledge the same bytes again.
		flow.acknowledge("browser", 8_192);
		expect(acknowledge).toHaveBeenCalledOnce();

		flow.acceptData(1_024);
		flow.acknowledge("browser", 1_024);
		expect(acknowledge).toHaveBeenCalledTimes(2);
		expect(acknowledge).toHaveBeenLastCalledWith(1_024);
		flow.acknowledge("api", 1_024);
		expect(acknowledge).toHaveBeenCalledTimes(2);
	});

	test("a client cannot acknowledge more than the pty produced", () => {
		const acknowledge = vi.fn();
		const flow = new TerminalDataFlowControl(acknowledge);
		flow.register("browser");
		flow.acceptData(10);

		flow.acknowledge("browser", 1_000);

		expect(acknowledge).toHaveBeenCalledOnce();
		expect(acknowledge).toHaveBeenCalledWith(10);
	});

	test("an unregistered client is a crash, never a silent arbitration", () => {
		const flow = new TerminalDataFlowControl(vi.fn());
		expect(() => flow.acknowledge("stranger", 10)).toThrow("is not registered");
		expect(() => {
			flow.register("browser");
			flow.acceptData(-1);
		}).toThrow("Invalid terminal data length");
		expect(() => flow.acknowledge("browser", -1)).toThrow(
			"Invalid terminal acknowledgement"
		);
	});

	test("the last client to leave drains what nobody acknowledged", () => {
		// The pty pauses above its high watermark until the outstanding bytes are
		// acknowledged. With every client gone there is nobody left to do it, so
		// a terminal whose only reader disconnected would stall mid-command - the
		// documented promise is that it keeps running.
		const acknowledge = vi.fn();
		const flow = new TerminalDataFlowControl(acknowledge);
		flow.register("api");
		flow.acceptData(8_192);

		flow.unregister("api");

		expect(acknowledge).toHaveBeenCalledOnce();
		expect(acknowledge).toHaveBeenCalledWith(8_192);

		// And it has to keep draining, or the very next chunk stalls it again.
		flow.acceptData(512);
		expect(acknowledge).toHaveBeenLastCalledWith(512);

		// A client arriving later starts at the tail rather than re-acknowledging
		// everything that ran while nobody was attached.
		flow.register("api");
		flow.acceptData(256);
		flow.acknowledge("api", 256);
		expect(acknowledge).toHaveBeenLastCalledWith(256);
		expect(acknowledge).toHaveBeenCalledTimes(3);
	});

	test("replay establishes a new live-data baseline", () => {
		const acknowledge = vi.fn();
		const flow = new TerminalDataFlowControl(acknowledge);
		flow.register("browser");
		flow.acceptData(10);
		flow.resetAfterReplay();
		flow.acceptData(5);
		flow.acknowledge("browser", 5);

		expect(acknowledge).toHaveBeenCalledOnce();
		expect(acknowledge).toHaveBeenCalledWith(5);
	});

	test("acknowledgements are attributed to the connection that sent them", () => {
		// Not to one shared name for "the editor": two browser tabs watching the
		// same terminal are two clients, and either one closing must not strip the
		// other's flow control.
		expect(added).toContain(
			"return this._ptyHostService.acknowledgeDataEvent(args[0], args[1], ctx.clientId);"
		);
		// But a client that has already detached is not an error: acknowledgements
		// are buffered and never awaited, so one landing late is routine and the
		// pty no longer has a slot to credit it to.
		expect(added).toContain(
			"if (!this._clientState.isAttached(args[0], ctx.clientId)) {\n					return;\n				}"
		);
		// The local (single-client) backend names itself rather than acknowledging
		// into a slot nothing registered.
		expect(added).toContain(
			"this._proxy.acknowledgeDataEvent(this.id, charCount, LocalPty._clientId);"
		);
		expect(added).toContain(
			"this._proxy.registerTerminalClient(this.id, LocalPty._clientId);"
		);
		expect(added).toContain(
			"this._ptyHostService.registerTerminalClient(args[0], ctx.clientId)"
		);
		expect(added).toContain(
			"this._ptyHostService.unregisterTerminalClient(args[0], ctx.clientId)"
		);
		expect(added).toContain(
			"this._ptyHostService.unregisterTerminalClient(detached.id, clientId)"
		);
		expect(added).not.toContain("'vscode'");
	});
});

describe("terminal API viewport protocol", () => {
	const resolveDimension = declaration(api, "function resolveDimension(");
	const parseMessage = declaration(
		api,
		"export function parseTerminalViewportMessage("
	).replace("export ", "");
	const { parseTerminalViewportMessage } = evaluatePatchSnippets<{
		parseTerminalViewportMessage: (data: string) => {
			type: "resize";
			cols: number;
			rows: number;
		};
	}>([resolveDimension, parseMessage], ["parseTerminalViewportMessage"]);

	test("accepts bounded resize messages and rejects inert controls", () => {
		expect(
			parseTerminalViewportMessage(
				JSON.stringify({ type: "resize", cols: 47, rows: 19 })
			)
		).toEqual({ type: "resize", cols: 47, rows: 19 });
		expect(() =>
			parseTerminalViewportMessage(
				JSON.stringify({ type: "resize", cols: 0, rows: 24 })
			)
		).toThrow("integers from 1 to 1000");
		expect(() =>
			parseTerminalViewportMessage(JSON.stringify({ type: "input" }))
		).toThrow('type must be "resize"');
		expect(() => parseTerminalViewportMessage("not json")).toThrow(
			"must be valid JSON"
		);
	});

	test("requires one protocol contract and owns a client lifecycle", () => {
		expect(api).toContain(
			'TERMINAL_VIEWPORT_PROTOCOL = "composery-terminal-v1"'
		);
		expect(api).toMatch(
			/protocols\.has\(TERMINAL_VIEWPORT_PROTOCOL\)\s*\?\s*TERMINAL_VIEWPORT_PROTOCOL\s*:\s*false/
		);
		expect(api).toContain(
			"!requestedProtocols.includes(TERMINAL_VIEWPORT_PROTOCOL)"
		);
		expect(api).toContain(
			'endWithStatus(req, 400, "Terminal Protocol Required")'
		);
		expect(api).toContain("if (isBinary)");
		expect(api).not.toContain("isViewport");
		expect(api).toContain("registerTerminalClient(id, clientId)");
		expect(api).toContain("activateTerminalViewport(id, clientId");
		expect(api).toContain("unregisterTerminalClient(id, clientId)");
		expect(apiDocs).toContain("server rejects attachments without it");
		expect(apiDocs).toContain("Binary client frames are terminal");
		expect(apiDocs).toContain("websocat --protocol composery-terminal-v1");
		expect(smoke).toContain('"Sec-WebSocket-Protocol: composery-terminal-v1"');
		expect(smoke).toContain(
			'headers["sec-websocket-protocol"] !== "composery-terminal-v1"'
		);
		expect(apiDocs).toContain(
			"server restores the most recently active attached viewport"
		);
		expect(apiDocs).not.toContain("legacy");
	});
});
