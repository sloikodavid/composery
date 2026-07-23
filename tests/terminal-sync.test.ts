import { describe, expect, test } from "vitest";

import {
	addedLines,
	evaluatePatchSnippets,
	extractAddedCaseBody,
	extractAddedFunction,
	extractAddedMethod,
	readRepoFile
} from "./support/patchSource.js";

const patch = readRepoFile("packages/ide/patches/terminal.diff");
const added = addedLines(patch);

interface Layout {
	workspaceId: string;
	tabs: {
		isActive: boolean;
		activePersistentProcessId?: number;
		terminals: { terminal: number; relativeSize: number }[];
	}[];
	background: number[] | null;
}

interface Process {
	workspaceId: string;
	shouldPersistTerminal: boolean;
	shellLaunchConfig: { hideFromUser?: boolean };
}

const { mergeTerminalLayouts } = evaluatePatchSnippets<{
	mergeTerminalLayouts: (
		workspaceId: string,
		layout: Layout | undefined,
		processes: Iterable<readonly [number, Process]>
	) => Layout | undefined;
}>(
	[extractAddedFunction(patch, "mergeTerminalLayouts")],
	["mergeTerminalLayouts"]
);

const remoteWorkspaceIdSource = extractAddedFunction(
	patch,
	"getRemoteTerminalWorkspaceId"
);

function evaluateRemoteWorkspaceId(source = remoteWorkspaceIdSource) {
	return evaluatePatchSnippets<{
		getRemoteTerminalWorkspaceId: (workspace: {
			configuration?: { path: string };
			folders: { uri: { path: string; toString(): string } }[];
		}) => string;
	}>(
		[
			`function hash(value) {
				let result = 0;
				for (const character of value) result = ((result << 5) - result + character.charCodeAt(0)) | 0;
				return result;
			}`,
			source
		],
		["getRemoteTerminalWorkspaceId"]
	).getRemoteTerminalWorkspaceId;
}

function extractAddedClass(name: string): string {
	const source = addedLines(patch);
	const start = source.indexOf(`export class ${name}`);
	if (start < 0) throw new Error(`Could not find class ${name}`);
	let depth = 0;
	for (let i = source.indexOf("{", start); i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}" && --depth === 0) {
			return source.slice(start, i + 1).replace(/^export /, "");
		}
	}
	throw new Error(`Could not parse class ${name}`);
}

const clientStateSource = extractAddedClass("TerminalClientState");

function evaluateClientState(source = clientStateSource) {
	return evaluatePatchSnippets<{
		TerminalClientState: new () => {
			attach(
				id: number,
				clientId: string,
				makeController: boolean,
				streaming?: boolean
			): void;
			detach(
				id: number,
				clientId: string
			): {
				attached: boolean;
				final: boolean;
				nextController?: string;
				dimensions?: { cols: number; rows: number };
			};
			detachClient(clientId: string): { id: number; final: boolean }[];
			isAttached(id: number, clientId: string): boolean;
			isController(id: number, clientId: string): boolean;
			isStreaming(id: number, clientId: string): boolean;
			markStreaming(id: number, clientId: string): void;
			acknowledge(id: number, clientId: string, charCount: number): number;
			recordDimensions(
				id: number,
				clientId: string,
				dimensions: { cols: number; rows: number }
			): boolean;
			takeControl(
				id: number,
				clientId: string
			): { cols: number; rows: number } | undefined;
		};
	}>([source], ["TerminalClientState"]).TerminalClientState;
}

const startStateSource = extractAddedClass("TerminalStartState");

function evaluateStartState() {
	return evaluatePatchSnippets<{
		TerminalStartState: new () => {
			target(id: number): string | undefined;
			replay(id: number): void;
			exit(id: number): void;
			run<T>(
				id: number,
				clientId: string,
				expectReplay: (result: T) => boolean,
				start: () => Promise<T>
			): Promise<T>;
		};
		expireReplayTimeout(): boolean;
	}>(
		[
			`const replayTimeoutResolvers = [];
			function promiseWithResolvers() {
				let resolve;
				let reject;
				const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
				return { promise, resolve, reject };
			}
			function raceTimeout(promise) {
				return Promise.race([promise, new Promise(resolve => replayTimeoutResolvers.push(resolve))]);
			}
			function expireReplayTimeout() {
				const resolvers = replayTimeoutResolvers.splice(0);
				for (const resolve of resolvers) resolve(undefined);
				return resolvers.length > 0;
			}`,
			startStateSource
		],
		["TerminalStartState", "expireReplayTimeout"]
	);
}

function process(
	workspaceId: string,
	options: { persist?: boolean; hidden?: boolean } = {}
): Process {
	return {
		workspaceId,
		shouldPersistTerminal: options.persist ?? true,
		shellLaunchConfig: options.hidden ? { hideFromUser: true } : {}
	};
}

describe("authoritative terminal inventory", () => {
	test("canonical workspace IDs ignore renderer origin but distinguish resources", () => {
		const identify = evaluateRemoteWorkspaceId();
		const workspace = (origin: string, path = "/home/user/Documents") => ({
			folders: [
				{
					uri: {
						path,
						toString: () => `vscode-remote://${origin}${path}`
					}
				}
			]
		});

		expect(identify(workspace("localhost:8080"))).toBe(
			identify(workspace("10.0.2.2:8080"))
		);
		expect(identify(workspace("localhost:8080"))).not.toBe(
			identify(workspace("localhost:8080", "/home/user/Desktop"))
		);

		const originSensitive = evaluateRemoteWorkspaceId(
			remoteWorkspaceIdSource.replace(
				"folder.uri.path",
				"folder.uri.toString()"
			)
		);
		expect(originSensitive(workspace("localhost:8080"))).not.toBe(
			originSensitive(workspace("10.0.2.2:8080"))
		);
	});

	test("merges missing foreground and hidden processes without mutating client layout", () => {
		const layout: Layout = {
			workspaceId: "workspace-a",
			tabs: [
				{
					isActive: true,
					activePersistentProcessId: 11,
					terminals: [{ terminal: 11, relativeSize: 1 }]
				}
			],
			background: null
		};
		const result = mergeTerminalLayouts("workspace-a", layout, [
			[11, process("workspace-a")],
			[12, process("workspace-a")],
			[13, process("workspace-a", { hidden: true })],
			[14, process("workspace-b")],
			[15, process("workspace-a", { persist: false })]
		]);

		expect(
			result?.tabs.flatMap((tab) =>
				tab.terminals.map((terminal) => terminal.terminal)
			)
		).toEqual([11, 12]);
		expect(result?.background).toEqual([13]);
		expect(layout.tabs).toHaveLength(1);
		expect(layout.background).toBeNull();
	});

	test("returns no layout when the workspace has no persistent inventory", () => {
		expect(
			mergeTerminalLayouts("workspace-a", undefined, [
				[1, process("workspace-b")],
				[2, process("workspace-a", { persist: false })]
			])
		).toBeUndefined();
	});

	test("legacy origin-specific inventories are merged once without duplicate PTYs", () => {
		const register = extractAddedMethod(patch, "_registerWorkspaceAlias");
		const merge = extractAddedMethod(patch, "_mergeTerminalLayoutInfos");
		const { Harness } = evaluatePatchSnippets<{
			Harness: new () => {
				_workspaceAliases: Map<string, Set<string>>;
				_workspaceClients: Map<string, Set<string>>;
				inventoryEvents: { workspaceId: string }[];
				_registerWorkspaceAlias(source: string, target: string): void;
				_mergeTerminalLayoutInfos(layouts: unknown[]): {
					tabs: { terminals: { terminal: { id: number } }[] }[];
					background: { id: number }[];
				};
			};
		}>(
			[
				`class Harness {
					_workspaceAliases = new Map();
					_latestLayouts = new Map();
					_layouts = new Map();
					_workspaceClients = new Map();
					_processWorkspaces = new Map();
					inventoryEvents = [];
					_onPersistentTerminalInventoryChange = { fire: event => this.inventoryEvents.push(event) };
					${register}
					${merge}
				}`
			],
			["Harness"]
		);
		const harness = new Harness();
		harness._registerWorkspaceAlias("phone-origin", "remote:documents");
		harness._registerWorkspaceAlias("laptop-origin", "remote:documents");
		expect([
			...(harness._workspaceAliases.get("remote:documents") ?? [])
		]).toEqual(["phone-origin", "laptop-origin"]);
		harness._workspaceClients.set("remote:documents", new Set(["phone"]));
		harness._registerWorkspaceAlias("tablet-origin", "remote:documents");
		expect(harness.inventoryEvents).toEqual([
			{ workspaceId: "remote:documents" }
		]);

		const terminal = (id: number) => ({ terminal: { id }, relativeSize: 1 });
		const merged = harness._mergeTerminalLayoutInfos([
			{
				tabs: [
					{
						isActive: true,
						activePersistentProcessId: 1,
						terminals: [terminal(1)]
					}
				],
				background: [{ id: 3 }]
			},
			{
				tabs: [
					{
						isActive: false,
						activePersistentProcessId: 1,
						terminals: [terminal(1), terminal(2)]
					}
				],
				background: [{ id: 3 }, { id: 4 }]
			}
		]);
		expect(
			merged.tabs.flatMap((tab) =>
				tab.terminals.map((entry) => entry.terminal.id)
			)
		).toEqual([1, 2]);
		expect(merged.background.map((entry) => entry.id)).toEqual([3, 4]);
	});
});

describe("per-client terminal attachment state", () => {
	test("only the final detach releases the pty and controller transfer restores cached dimensions", () => {
		const State = evaluateClientState();
		const state = new State();
		state.attach(41, "phone", true);
		state.attach(41, "laptop", false);
		state.attach(41, "tablet", false);
		expect(state.recordDimensions(41, "phone", { cols: 50, rows: 20 })).toBe(
			true
		);
		expect(state.recordDimensions(41, "laptop", { cols: 120, rows: 40 })).toBe(
			false
		);

		expect(state.detach(41, "phone")).toEqual({
			attached: true,
			final: false,
			nextController: "laptop",
			dimensions: { cols: 120, rows: 40 }
		});
		expect(state.isController(41, "laptop")).toBe(true);
		expect(state.detach(41, "laptop")).toMatchObject({
			attached: true,
			final: false
		});
		expect(state.detach(41, "tablet")).toMatchObject({
			attached: true,
			final: true
		});
		expect(state.isAttached(41, "tablet")).toBe(false);
	});

	test("unknown clients cannot detach or resize a terminal", () => {
		const State = evaluateClientState();
		const state = new State();
		state.attach(41, "phone", true);

		expect(state.detach(41, "stranger")).toEqual({
			attached: false,
			final: false
		});
		expect(
			state.recordDimensions(41, "stranger", { cols: 500, rows: 200 })
		).toBe(false);
		expect(state.isAttached(41, "phone")).toBe(true);
	});

	test("last input takes resize control", () => {
		const State = evaluateClientState();
		const state = new State();
		state.attach(9, "phone", true);
		state.attach(9, "laptop", false);
		state.recordDimensions(9, "laptop", { cols: 160, rows: 50 });

		expect(state.takeControl(9, "laptop")).toEqual({ cols: 160, rows: 50 });
		expect(state.isController(9, "phone")).toBe(false);
		expect(state.isController(9, "laptop")).toBe(true);
	});

	test("the fastest attached renderer advances ACKs without double-counting", () => {
		const State = evaluateClientState();
		const state = new State();
		state.attach(9, "phone", true);
		state.attach(9, "laptop", false);

		expect(state.acknowledge(9, "phone", 5000)).toBe(5000);
		expect(state.acknowledge(9, "laptop", 5000)).toBe(0);
		expect(state.acknowledge(9, "laptop", 5000)).toBe(5000);
		expect(state.acknowledge(9, "phone", 5000)).toBe(0);
		expect(state.acknowledge(9, "stranger", 5000)).toBe(0);
	});

	test("disconnecting one client releases only its final attachments", () => {
		const State = evaluateClientState();
		const state = new State();
		state.attach(1, "phone", true);
		state.attach(1, "laptop", false);
		state.attach(2, "phone", true);

		expect(state.detachClient("phone")).toEqual([
			{ id: 1, final: false, dimensions: undefined },
			{ id: 2, final: true, dimensions: undefined }
		]);
		expect(state.isAttached(1, "laptop")).toBe(true);
	});

	test("a freshly attached client does not stream live data until its replay lands", () => {
		const State = evaluateClientState();
		const state = new State();

		// The creating client streams immediately: a fresh terminal has no prior output,
		// so there is nothing a replay could duplicate.
		state.attach(5, "phone", true, true);
		expect(state.isStreaming(5, "phone")).toBe(true);

		// A client attaching to a running terminal must NOT receive live data until its
		// replay lands. Otherwise data from the attach->replay window is written to its
		// xterm and then re-rendered by the full-buffer replay - duplicated lines.
		state.attach(5, "laptop", false);
		expect(state.isAttached(5, "laptop")).toBe(true);
		expect(state.isStreaming(5, "laptop")).toBe(false);

		// The replay landing opens the stream; live data flows from the snapshot boundary on.
		state.markStreaming(5, "laptop");
		expect(state.isStreaming(5, "laptop")).toBe(true);

		// Streaming is always a subset of attachment: a stranger streams nothing, and
		// detaching closes the stream so a re-attach waits for a fresh replay.
		state.markStreaming(5, "stranger");
		expect(state.isStreaming(5, "stranger")).toBe(false);
		state.detach(5, "laptop");
		expect(state.isStreaming(5, "laptop")).toBe(false);
	});

	test("the controller guard is mutation-tested", () => {
		const mutated = clientStateSource.replace(
			"return this.isController(id, clientId);",
			"return true;"
		);
		const MutatedState = evaluateClientState(mutated);
		const state = new MutatedState();
		state.attach(1, "phone", true);
		state.attach(1, "laptop", false);
		expect(() => {
			if (state.recordDimensions(1, "laptop", { cols: 100, rows: 30 })) {
				throw new Error("non-controller resize reached the pty host");
			}
		}).toThrow("non-controller resize reached the pty host");
	});
});

describe("renderer synchronization", () => {
	test("concurrent starts keep each replay bound to its requesting renderer", async () => {
		const { TerminalStartState: State } = evaluateStartState();
		const state = new State();
		const order: string[] = [];
		const first = state.run(
			7,
			"phone",
			() => true,
			() => {
				order.push("phone");
				return Promise.resolve("first");
			}
		);
		await Promise.resolve();
		expect(state.target(7)).toBe("phone");

		const second = state.run(
			7,
			"laptop",
			() => true,
			() => {
				order.push("laptop");
				return Promise.resolve("second");
			}
		);
		await Promise.resolve();
		expect(state.target(7)).toBe("phone");

		state.replay(7);
		await expect(first).resolves.toBe("first");
		await Promise.resolve();
		await Promise.resolve();
		expect(state.target(7)).toBe("laptop");
		state.replay(7);
		await expect(second).resolves.toBe("second");
		expect(order).toEqual(["phone", "laptop"]);
	});

	test("an exit cannot leave a queued start waiting forever", async () => {
		const { TerminalStartState: State } = evaluateStartState();
		const state = new State();
		const start = state.run(
			7,
			"phone",
			() => true,
			() => Promise.resolve(undefined)
		);
		await Promise.resolve();
		state.exit(7);
		await expect(start).rejects.toThrow("exited before its replay completed");
	});

	test("a missing replay fails instead of hanging the attach forever", async () => {
		const evaluated = evaluateStartState();
		const State = evaluated.TerminalStartState;
		const state = new State();
		const start = state.run(
			7,
			"phone",
			() => true,
			() => Promise.resolve(undefined)
		);
		let expired = false;
		for (let i = 0; i < 10 && !expired; i++) {
			await Promise.resolve();
			expired = evaluated.expireReplayTimeout();
		}
		expect(expired).toBe(true);
		await expect(start).rejects.toThrow(
			"timed out before its replay completed"
		);
	});

	test("bursts coalesce and a failed run does not poison later sync", async () => {
		const method = extractAddedMethod(patch, "_queueRemoteTerminalSync");
		const { Harness } = evaluatePatchSnippets<{
			Harness: new () => {
				calls: number;
				fail: boolean;
				_queueRemoteTerminalSync(backend: object): Promise<void>;
			};
		}>(
			[
				`class Harness {
					_remoteTerminalSync;
					_remoteTerminalSyncRequested = false;
					calls = 0;
					fail = true;
					async _syncRemoteTerminals() {
						this.calls++;
						if (this.fail) { this.fail = false; throw new Error('sync failed'); }
					}
					${method}
				}`
			],
			["Harness"]
		);
		const harness = new Harness();
		await expect(harness._queueRemoteTerminalSync({})).rejects.toThrow(
			"sync failed"
		);
		await harness._queueRemoteTerminalSync({});
		expect(harness.calls).toBe(2);
	});

	test("ready and replay are target-only, exit needs attachment, data needs a landed replay", () => {
		expect(added).toContain("this._startState.target(e.id) === ctx.clientId");
		// Exit must reach every attached client (even one mid-replay) so it can dispose.
		expect(added).toContain(
			"case RemoteTerminalChannelEvent.OnProcessExitEvent: return Event.filter(this._ptyHostService.onProcessExit, e => this._clientState.isAttached(e.id, ctx.clientId))"
		);
		// Live data must be gated on streaming, not raw attachment: a just-attached client
		// receives nothing until its replay lands (marked streaming), so the attach->replay
		// window is never duplicated on top of the full-buffer replay.
		expect(added).toContain(
			"case RemoteTerminalChannelEvent.OnProcessDataEvent: return Event.filter(this._ptyHostService.onProcessData, e => this._clientState.isStreaming(e.id, ctx.clientId))"
		);
		expect(added).toContain("this._clientState.markStreaming(e.id, target)");
		expect(added).toContain("OnPersistentTerminalInventoryChange");
		expect(added).not.toContain("unknown persistent");
		expect(added).toContain("is not attached to terminal");
	});

	test("each workbench has a stable unique identity and per-client layout", () => {
		expect(added).toContain("`renderer:${generateUuid()}`");
		expect(added).toContain(
			"new Map<string, Map<string, ISetTerminalLayoutInfoArgs>>()"
		);
		expect(added).toContain(
			"byWorkspace.get(getArgs.workspaceId) ?? this._latestLayouts.get(getArgs.workspaceId)"
		);
		expect(added).toContain(
			"terminal.terminal.isOrphan = !this._clientState.isAttached"
		);
		expect(
			added.match(
				/workspaceId: this\._workspaceContextService\.getWorkspace\(\)\.id/g
			)
		).toHaveLength(3);
		expect(added.match(/clientWorkspaceId: string;/g)).toHaveLength(2);
		expect(added.match(/clientWorkspaceId\?: string;/g)).toHaveLength(2);
	});

	test("initial sync restores groups while background creation remains single-owned", () => {
		expect(added).toContain("await this._syncRemoteTerminals(backend, true)");
		expect(added).toContain(
			"const groups = this._recreateTerminalGroups(layoutInfo)"
		);
		expect(added).toContain("this._reconnectedTerminalGroups = groups");
		expect(added).not.toContain(
			"this._backgroundedTerminalInstances.push(...revivedInstances"
		);
		expect(added).toContain("failOnAttachError: true");
		expect(
			added.match(
				/return \{ message: `Could not find pty with id \$\{shellLaunchConfig\.attachPersistentProcess\.id\} to synchronize` \}/g
			)
		).toHaveLength(2);
	});

	test("initial reconnect sync runs before the listener, then catches up", () => {
		// The initial sync must finish before the inventory listener can fire a
		// concurrent sync: two syncs racing on independent getTerminalLayoutInfo
		// snapshots each see the same terminal as unattached and double-create it.
		// A catch-up queue call after registration then covers any event that
		// arrived during the initial sync's window (the listener was not live yet).
		const initialIdx = added.indexOf(
			"await this._syncRemoteTerminals(backend, true)"
		);
		const listenerIdx = added.indexOf("backend.onDidRequestTerminalSync(e =>");
		expect(initialIdx).toBeGreaterThanOrEqual(0);
		expect(listenerIdx).toBeGreaterThan(initialIdx);
		expect(
			added.match(/void this\._queueRemoteTerminalSync\(backend\)/g)
		).toHaveLength(2);
	});

	test("a raced attach disposes the phantom silently, no zombie or rogue shell", () => {
		// When a synced terminal exits server-side between getTerminalLayoutInfo and
		// the attach, the attach fails. Upstream would spawn a fresh shell in the
		// tab (a rogue terminal); throwing instead leaves an unhandled rejection and
		// a process-less tab. We return a launch error whose message upstream's
		// parseExitResult treats as an internal error, so the instance disposes with
		// no notification. Pin that coupling: an upstream rename of the sentinel must
		// fail here rather than silently turn the error toast back on.
		expect(
			added.match(
				/return \{ message: `Could not find pty with id \$\{shellLaunchConfig\.attachPersistentProcess\.id\} to synchronize` \}/g
			)
		).toHaveLength(2);

		const terminalInstance = readRepoFile(
			"packages/ide/upstream/lib/vscode/src/vs/workbench/contrib/terminal/browser/terminalInstance.ts"
		);
		const sentinel = /\.message\.toString\(\)\.includes\('([^']+)'\)/.exec(
			terminalInstance
		)?.[1];
		expect(sentinel).toBe("Could not find pty with id");
		expect("Could not find pty with id 7 to synchronize").toContain(sentinel!);
	});

	test("single-recipient events and client maps are released on disconnect", () => {
		expect(added).toContain(
			"this._clientState.isController(e.persistentProcessId, ctx.clientId)"
		);
		expect(added).toContain(
			"this._clientState.isController(e.id, ctx.clientId)"
		);
		expect(added).toContain(
			"this._isWorkspaceLeader(this._canonicalWorkspaceId(e.workspaceId), ctx.clientId)"
		);
		expect(added).toContain(
			"this._workspaceClients.get(e.workspaceId)?.has(clientId) ?? false"
		);
		expect(added).toContain("this._layouts.delete(clientId)");
	});

	test("obsolete orphan probing and immortal parking are gone", () => {
		expect(added).not.toContain("_isDetached");
		expect(added).not.toContain("if (!await this.isOrphaned())");
		expect(added).not.toContain("Parked until a renderer attaches");
	});
});

// The client state machine is well covered above, but nothing proved the channel
// dispatch consumes it correctly - a correct state machine wired to the wrong
// branch still kills a live terminal. These drive the shipped case bodies against
// the real TerminalClientState, so only the dispatch itself is under test.
describe("channel dispatch honours the client state machine", () => {
	function evaluateDispatch() {
		return evaluatePatchSnippets<{
			Channel: new () => {
				attach(clientId: string, id: number): Promise<void>;
				detach(
					clientId: string,
					id: number,
					forcePersist?: boolean
				): Promise<void>;
				resize(clientId: string, id: number, cols: number, rows: number): void;
				input(clientId: string, id: number, data: string): Promise<void>;
				calls: string[];
			};
		}>(
			[
				clientStateSource,
				`class Channel {
					calls = [];
					_clientState = new TerminalClientState();
					_ptyHostService = {
						attachToProcess: async (id) => { this.calls.push('attach:' + id); },
						detachFromProcess: async (id, forcePersist) => { this.calls.push('detach:' + id + ':' + Boolean(forcePersist)); },
						resize: async (id, cols, rows) => { this.calls.push('resize:' + id + ':' + cols + 'x' + rows); },
						input: async (id, data) => { this.calls.push('input:' + id + ':' + data); }
					};
					async attach(clientId, id) {
						const ctx = { clientId };
						const args = [id];
						${extractAddedCaseBody(patch, "AttachToProcess", "RemoteTerminalChannelRequest")}
					}
					async detach(clientId, id, forcePersist) {
						const ctx = { clientId };
						const args = [id, forcePersist];
						${extractAddedCaseBody(patch, "DetachFromProcess", "RemoteTerminalChannelRequest")}
					}
					async input(clientId, id, data) {
						const ctx = { clientId };
						const args = [id, data];
						${extractAddedCaseBody(patch, "Input", "RemoteTerminalChannelRequest")}
					}
					resize(clientId, id, cols, rows) {
						this._clientState.recordDimensions(id, clientId, { cols, rows });
					}
				}`
			],
			["Channel"]
		);
	}

	test("a phone closing its tab does not release a terminal the laptop still holds", async () => {
		const { Channel } = evaluateDispatch();
		const channel = new Channel();

		await channel.attach("phone", 41);
		await channel.attach("laptop", 41);
		await channel.detach("phone", 41);

		expect(channel.calls).not.toContain("detach:41:false");
		expect(channel.calls.filter((c) => c.startsWith("detach:"))).toHaveLength(
			0
		);
	});

	test("the last client leaving releases the terminal exactly once", async () => {
		const { Channel } = evaluateDispatch();
		const channel = new Channel();

		await channel.attach("phone", 41);
		await channel.attach("laptop", 41);
		await channel.detach("phone", 41);
		await channel.detach("laptop", 41, true);

		expect(channel.calls.filter((c) => c.startsWith("detach:"))).toEqual([
			"detach:41:true"
		]);
	});

	test("a detach from a client that never attached is ignored", async () => {
		const { Channel } = evaluateDispatch();
		const channel = new Channel();

		await channel.attach("laptop", 41);
		await channel.detach("stranger", 41);

		// A stale detach from a dead connection must not reach the pty host.
		expect(channel.calls.filter((c) => c.startsWith("detach:"))).toHaveLength(
			0
		);
	});

	test("losing the controller resizes the pty to the surviving client", async () => {
		const { Channel } = evaluateDispatch();
		const channel = new Channel();

		await channel.attach("phone", 41);
		await channel.attach("laptop", 41);
		channel.resize("laptop", 41, 100, 30);
		channel.resize("phone", 41, 40, 20);
		await channel.detach("phone", 41);

		// The phone owned the size; handing control back must not leave the laptop
		// rendering into a 40-column pty.
		expect(channel.calls).toContain("resize:41:100x30");
	});

	test("a settled controller does not re-resize the pty on every keystroke", async () => {
		const { Channel } = evaluateDispatch();
		const channel = new Channel();

		await channel.attach("phone", 41); // first attach becomes the controller
		await channel.attach("laptop", 41);
		channel.resize("phone", 41, 80, 24);
		channel.resize("laptop", 41, 120, 40);

		// The controller typing must not resize: the pty already has its size, and a
		// resize per keystroke is an extra pty-host round-trip on the hot path (and
		// flushes the output batcher) that upstream never pays.
		await channel.input("phone", 41, "a");
		await channel.input("phone", 41, "b");
		expect(channel.calls.filter((c) => c.startsWith("resize:"))).toHaveLength(
			0
		);

		// A different client typing takes control and asserts its size exactly once,
		// then stops resizing once it is the settled controller.
		await channel.input("laptop", 41, "c");
		await channel.input("laptop", 41, "d");
		expect(channel.calls.filter((c) => c.startsWith("resize:"))).toEqual([
			"resize:41:120x40"
		]);

		// Every keystroke still reaches the pty regardless of the resize decision.
		expect(channel.calls.filter((c) => c.startsWith("input:"))).toEqual([
			"input:41:a",
			"input:41:b",
			"input:41:c",
			"input:41:d"
		]);
	});
});
