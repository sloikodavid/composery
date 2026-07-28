import { describe, expect, test } from "vitest";

import { readRepoFile } from "../../../../tests/support/repo.ts";
import {
	addedLines,
	evaluatePatchSnippets,
	extractAddedCaseBody,
	extractAddedClass,
	extractAddedFunction,
	extractAddedMethod
} from "../support/patch.ts";

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

const clientStateSource = extractAddedClass(patch, "TerminalClientState");

function evaluateClientState(source = clientStateSource) {
	return evaluatePatchSnippets<{
		TerminalClientState: new () => {
			attach(
				id: number,
				clientId: string,
				makeUiTarget: boolean,
				streaming?: boolean
			): void;
			detach(
				id: number,
				clientId: string
			): { attached: boolean; final: boolean };
			detachClient(clientId: string): { id: number; final: boolean }[];
			isAttached(id: number, clientId: string): boolean;
			isUiTarget(id: number, clientId: string): boolean;
			isStreaming(id: number, clientId: string): boolean;
			takeUiControl(id: number, clientId: string): void;
			markStreaming(id: number, clientId: string): void;
		};
	}>([source], ["TerminalClientState"]).TerminalClientState;
}

const startStateSource = extractAddedClass(patch, "TerminalStartState");

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

	test("a backend answers to the same workspace id it reports", () => {
		// The canonical id goes out on every request, so it is the id that comes
		// back on a pty-host request. Upstream compares against the raw workspace
		// id; left alone that comparison can never match and variable resolution
		// silently never answers. One accessor, both directions.
		expect(added).toContain("if (e.workspaceId !== this._getWorkspaceId()) {");
		expect(added).toContain(
			"protected override _getWorkspaceId(): string {\n\t\treturn getRemoteTerminalWorkspaceId(this._workspaceContextService.getWorkspace());"
		);
		expect(added).not.toContain(
			"OnPtyHostRequestResolveVariablesEvent), event => ({ ...event,"
		);
		// Exactly one remap survives: a detach request names an instance by the
		// URI the window built from its own workspace id.
		expect(
			added.match(
				/workspaceId: this\._workspaceContextService\.getWorkspace\(\)\.id/g
			)
		).toHaveLength(1);
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
});

describe("per-client terminal attachment state", () => {
	test("only the final detach releases the pty, and the UI target moves on", () => {
		const State = evaluateClientState();
		const state = new State();
		state.attach(41, "phone", true);
		state.attach(41, "laptop", false);
		state.attach(41, "tablet", false);
		expect(state.isUiTarget(41, "phone")).toBe(true);

		expect(state.detach(41, "phone")).toEqual({ attached: true, final: false });
		expect(state.isUiTarget(41, "laptop")).toBe(true);
		expect(state.detach(41, "laptop")).toEqual({
			attached: true,
			final: false
		});
		expect(state.detach(41, "tablet")).toEqual({ attached: true, final: true });
		expect(state.isAttached(41, "tablet")).toBe(false);
	});

	test("unknown clients cannot detach or take over a terminal", () => {
		const State = evaluateClientState();
		const state = new State();
		state.attach(41, "phone", true);

		expect(state.detach(41, "stranger")).toEqual({
			attached: false,
			final: false
		});
		state.takeUiControl(41, "stranger");
		expect(state.isUiTarget(41, "stranger")).toBe(false);
		expect(state.isUiTarget(41, "phone")).toBe(true);
		expect(state.isAttached(41, "phone")).toBe(true);
	});

	test("last input takes the single-recipient events", () => {
		const State = evaluateClientState();
		const state = new State();
		state.attach(9, "phone", true);
		state.attach(9, "laptop", false);

		state.takeUiControl(9, "laptop");
		expect(state.isUiTarget(9, "phone")).toBe(false);
		expect(state.isUiTarget(9, "laptop")).toBe(true);
	});

	test("disconnecting one client releases only its final attachments", () => {
		const State = evaluateClientState();
		const state = new State();
		state.attach(1, "phone", true);
		state.attach(1, "laptop", false);
		state.attach(2, "phone", true);

		expect(state.detachClient("phone")).toEqual([
			{ id: 1, final: false },
			{ id: 2, final: true }
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

	test("the attachment guard is mutation-tested", () => {
		const mutated = clientStateSource.replace(
			"		if (this.isAttached(id, clientId)) {\n			this._uiTargets.set(id, clientId);",
			"		if (true) {\n			this._uiTargets.set(id, clientId);"
		);
		expect(mutated).not.toBe(clientStateSource);
		const MutatedState = evaluateClientState(mutated);
		const state = new MutatedState();
		state.attach(1, "phone", true);
		state.takeUiControl(1, "stranger");
		expect(state.isUiTarget(1, "stranger")).toBe(true);
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

	test("a coalesced re-sync never double-creates a terminal whose attach is in flight", async () => {
		// createTerminal resolves before its attach reaches the pty host, so when a burst of
		// inventory events makes the queue loop run a second sync, the server still reports the
		// just-created terminal as unattached (isOrphan). Without the this.instances guard the
		// observing client creates it twice - the "one terminal opens as several" symptom.
		const method = extractAddedMethod(patch, "_syncRemoteTerminals");
		const { Harness } = evaluatePatchSnippets<{
			Harness: new () => {
				created: number[];
				_syncRemoteTerminals(backend: object): Promise<void>;
			};
		}>(
			[
				`function mark() {}
				class Harness {
					instances = [];
					created = [];
					_reconnectedTerminalGroups;
					_recreateTerminalGroups(layout) {
						for (const tab of layout.tabs) for (const t of tab.terminals) if (t.terminal) {
							this.created.push(t.terminal.id);
							this.instances.push({ shellLaunchConfig: { attachPersistentProcess: { id: t.terminal.id } } });
						}
						return Promise.resolve([]);
					}
					async _reviveBackgroundTerminalInstances(bg) {
						for (const t of bg) if (t) {
							this.created.push(t.id);
							this.instances.push({ shellLaunchConfig: { attachPersistentProcess: { id: t.id } } });
						}
						return [];
					}
					${method}
				}`
			],
			["Harness"]
		);
		// The server keeps reporting both terminals as orphaned across both syncs.
		const backend = {
			getTerminalLayoutInfo: () =>
				Promise.resolve({
					tabs: [
						{
							isActive: true,
							activePersistentProcessId: 5,
							terminals: [
								{ terminal: { id: 5, isOrphan: true }, relativeSize: 1 }
							]
						}
					],
					background: [{ id: 6, isOrphan: true }]
				})
		};
		const harness = new Harness();
		await harness._syncRemoteTerminals(backend);
		await harness._syncRemoteTerminals(backend);
		expect(harness.created).toEqual([5, 6]);
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
	});

	test("the inventory event carries no fact the receiver already knows", () => {
		// The server only sends it to clients of that workspace, so a workspace
		// check on the renderer compares a value with itself - a guard that cannot
		// fail, kept alive by remapping the id on the way in just to satisfy it.
		expect(added).toContain(
			"onPersistentTerminalInventoryChange(() => this._onDidRequestTerminalSync.fire())"
		);
		expect(added).toContain("readonly onDidRequestTerminalSync?: Event<void>;");
		expect(added).not.toContain(
			"e.workspaceId === this._workspaceContextService.getWorkspace().id"
		);
	});

	test("a request only one client can answer goes to that client", () => {
		// A resolve-variables reply settles the request store, so exactly one
		// client should send it - but a detach request names an instance of one
		// particular window, and asking only the workspace leader leaves a drag
		// between windows unanswered until the store times out.
		expect(added).toContain(
			"OnPtyHostRequestResolveVariablesEvent: return Event.filter(this._ptyHostService.onPtyHostRequestResolveVariables || Event.None, e => this._isWorkspaceLeader(e.workspaceId, ctx.clientId))"
		);
		expect(added).toContain(
			"OnDidRequestDetach: return Event.filter(this._ptyHostService.onDidRequestDetach || Event.None, e => this._isWorkspaceClient(e.workspaceId, ctx.clientId))"
		);
		expect(added).toContain(
			"this._clientState.isUiTarget(e.persistentProcessId, ctx.clientId)"
		);
		expect(added).toContain("this._clientState.isUiTarget(e.id, ctx.clientId)");
		expect(added).toContain("this._layouts.delete(clientId)");
	});

	test("initial sync restores groups while background creation remains single-owned", () => {
		expect(added).toContain("await this._syncRemoteTerminals(backend, true)");
		// Recreated from the owned-filtered layout, not the raw server layout.
		expect(added).toContain(
			"const groups = this._recreateTerminalGroups(layout)"
		);
		expect(added).toContain("this._reconnectedTerminalGroups = groups");
		expect(added).not.toContain(
			"this._backgroundedTerminalInstances.push(...revivedInstances"
		);
		expect(added).toContain("failOnAttachError: true");
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
		const listenerIdx = added.indexOf("backend.onDidRequestTerminalSync(");
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
				input(clientId: string, id: number, data: string): Promise<void>;
				uiTarget(id: number): string | undefined;
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
					uiTarget(id) {
						for (const clientId of ['phone', 'laptop', 'stranger']) {
							if (this._clientState.isUiTarget(id, clientId)) return clientId;
						}
						return undefined;
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

	test("typing moves the single-recipient events without disturbing the pty", async () => {
		const { Channel } = evaluateDispatch();
		const channel = new Channel();

		await channel.attach("phone", 41);
		await channel.attach("laptop", 41);
		expect(channel.uiTarget(41)).toBe("phone");

		await channel.input("laptop", 41, "a");
		expect(channel.uiTarget(41)).toBe("laptop");

		// Input is a hot path: taking over must not cost a pty-host round trip.
		expect(channel.calls.filter((c) => !c.startsWith("attach:"))).toEqual([
			"input:41:a"
		]);
	});

	test("input from a client that never attached is refused", async () => {
		const { Channel } = evaluateDispatch();
		const channel = new Channel();

		await channel.attach("phone", 41);
		await expect(channel.input("stranger", 41, "a")).rejects.toThrow(
			"is not attached to terminal"
		);
		expect(channel.uiTarget(41)).toBe("phone");
	});
});
