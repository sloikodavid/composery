import { describe, expect, test } from "vitest";

import {
	addedLines,
	evaluatePatchSnippets,
	readRepoFile
} from "./support/patchSource.js";

const viewportPatch = readRepoFile(
	"packages/ide/patches/terminal-viewport.diff"
);
const viewportAdded = addedLines(viewportPatch);
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

const viewportMethods = [
	"registerViewport",
	"unregisterViewport",
	"resizeViewport",
	"activateViewport"
].map((name) => declaration(viewportAdded, `\n\t${name}(`).trim());

function viewportState(methods = viewportMethods) {
	return evaluatePatchSnippets<{
		ViewportState: new () => {
			calls: Array<{ cols: number; rows: number }>;
			registerViewport(id: string): void;
			unregisterViewport(id: string): void;
			resizeViewport(id: string, cols: number, rows: number): void;
			activateViewport(id: string, cols: number, rows: number): void;
		};
	}>(
		[
			`interface IViewportDimensions { cols: number; rows: number; pixelWidth?: number; pixelHeight?: number }
			class ViewportState {
				private readonly _viewports = new Map<string, { dimensions?: IViewportDimensions; activation: number }>();
				private _activeViewport: string | undefined;
				private _viewportActivation = 0;
				readonly calls: IViewportDimensions[] = [];
				private _resize(dimensions: IViewportDimensions): void { this.calls.push(dimensions); }
				${methods.join("\n")}
			}`
		],
		["ViewportState"]
	).ViewportState;
}

describe("terminal viewport arbitration", () => {
	test("only an active viewport resizes and disconnect restores the MRU viewport", () => {
		const State = viewportState();
		const state = new State();
		state.registerViewport("phone");
		state.registerViewport("laptop");
		state.resizeViewport("phone", 40, 20);
		state.resizeViewport("laptop", 160, 50);
		expect(state.calls).toEqual([]);

		state.activateViewport("laptop", 160, 50);
		state.activateViewport("phone", 40, 20);
		state.resizeViewport("laptop", 150, 45);
		expect(state.calls).toEqual([
			{ cols: 160, rows: 50, pixelWidth: undefined, pixelHeight: undefined },
			{ cols: 40, rows: 20, pixelWidth: undefined, pixelHeight: undefined }
		]);

		state.unregisterViewport("phone");
		expect(state.calls.at(-1)).toEqual({
			cols: 150,
			rows: 45,
			pixelWidth: undefined,
			pixelHeight: undefined
		});
	});

	test("disconnect never promotes a viewport that was only laid out passively", () => {
		const State = viewportState();
		const state = new State();
		state.registerViewport("phone");
		state.registerViewport("background");
		state.resizeViewport("background", 200, 60);
		state.activateViewport("phone", 40, 20);
		state.unregisterViewport("phone");
		expect(state.calls).toHaveLength(1);

		const mutated = viewportMethods.map((method) =>
			method.replace("viewport.activation > 0 && ", "")
		);
		const MutatedState = viewportState(mutated);
		const broken = new MutatedState();
		broken.registerViewport("phone");
		broken.registerViewport("background");
		broken.resizeViewport("background", 200, 60);
		broken.activateViewport("phone", 40, 20);
		broken.unregisterViewport("phone");
		expect(broken.calls).toHaveLength(2);
	});

	test("unknown viewport ids fail instead of silently resizing", () => {
		const State = viewportState();
		const state = new State();
		expect(() => state.resizeViewport("stranger", 80, 24)).toThrow(
			"is not registered"
		);
		expect(() => state.activateViewport("stranger", 80, 24)).toThrow(
			"is not registered"
		);
	});

	test("renderer activation uses interaction capabilities without changing touch focus", () => {
		expect(viewportAdded).toContain(
			"@IHostService private readonly _hostService: IHostService"
		);
		expect(viewportAdded).toContain(
			"dom.addDisposableListener(xterm.raw.element, 'touchstart'"
		);
		expect(viewportAdded).toContain(
			"dom.addDisposableListener(xterm.raw.element, dom.EventType.MOUSE_WHEEL"
		);
		expect(viewportAdded).not.toContain(
			"dom.addDisposableListener(xterm.raw.element, 'touchstart', () => {\n\txterm.raw.focus()"
		);
		expect(viewportAdded).toContain(
			"this._remoteTerminalChannel.activateViewport"
		);
		expect(viewportAdded).toContain("this._process?.activateViewport?.");
	});

	test("PTY resize deduplication compares the whole reported geometry", () => {
		expect(viewportAdded).toContain(
			"this._dimensions.cols === dimensions.cols && this._dimensions.rows === dimensions.rows &&"
		);
		expect(viewportAdded).toContain(
			"this._dimensions.pixelWidth === dimensions.pixelWidth && this._dimensions.pixelHeight === dimensions.pixelHeight"
		);
	});

	test("workbench UI targeting is separate from viewport activation", () => {
		expect(viewportAdded).toContain("private readonly _uiTargets");
		expect(viewportAdded).toContain("takeUiControl");
		expect(viewportAdded).toContain("isUiTarget");
		expect(viewportAdded).not.toContain("_controllers");
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

	test("requires one protocol contract and owns a viewport lifecycle", () => {
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
		expect(api).toContain("registerTerminalViewport(id, consumerId)");
		expect(api).toContain("activateTerminalViewport(id, consumerId");
		expect(api).toContain("unregisterTerminalViewport(id, consumerId)");
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
