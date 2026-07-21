import { describe, expect, test } from "vitest";

import {
	addedLines,
	evaluatePatchSnippets,
	extractAddedFunction,
	readRepoFile
} from "./support/patchSource.js";

const patch = readRepoFile("packages/ide/patches/terminal-sync.diff");
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

describe("cross-renderer terminal layout reconciliation", () => {
	test("discovers an attached terminal when the renderer has no saved layout", () => {
		const result = mergeTerminalLayouts("workspace-a", undefined, [
			[41, process("workspace-a")]
		]);

		expect(result).toEqual({
			workspaceId: "workspace-a",
			tabs: [
				{
					isActive: false,
					activePersistentProcessId: 41,
					terminals: [{ terminal: 41, relativeSize: 1 }]
				}
			],
			background: []
		});
	});

	test("fills a partial browser snapshot without duplicating known terminals", () => {
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
			[12, process("workspace-a")]
		]);

		expect(
			result?.tabs.flatMap((tab) =>
				tab.terminals.map((terminal) => terminal.terminal)
			)
		).toEqual([11, 12]);
		expect(layout.tabs).toHaveLength(1);
		expect(layout.background).toBeNull();
	});

	test("keeps hidden terminals in background state", () => {
		const result = mergeTerminalLayouts("workspace-a", undefined, [
			[21, process("workspace-a", { hidden: true })]
		]);

		expect(result?.tabs).toEqual([]);
		expect(result?.background).toEqual([21]);
	});

	test("does not leak terminals across workspaces or restore transient processes", () => {
		const result = mergeTerminalLayouts("workspace-a", undefined, [
			[31, process("workspace-b")],
			[32, process("workspace-a", { persist: false })]
		]);

		expect(result).toBeUndefined();
	});
});

describe("cross-renderer terminal lifecycle guards", () => {
	test("a detaching renderer stops answering before the host checks ownership", () => {
		const detached = added.indexOf("this._isDetached = true;");
		const detachCall = added.indexOf(
			"this._remoteTerminalChannel.detachFromProcess(this.id, forcePersist)"
		);
		expect(detached).toBeGreaterThan(-1);
		expect(detachCall).toBeGreaterThan(detached);
		expect(added).toContain("if (!this._isDetached)");
		expect(added.match(/this\._isDetached = true;/g)).toHaveLength(2);
		expect(added.match(/this\._isDetached = false;/g)).toHaveLength(2);
	});

	test("the host parks the final detached process instead of expiring it", () => {
		const ownershipCheck = patch.indexOf("if (!await this.isOrphaned())");
		const parked = patch.indexOf(
			"Parked until a renderer attaches or the user closes it",
			ownershipCheck
		);
		expect(ownershipCheck).toBeGreaterThan(-1);
		expect(parked).toBeGreaterThan(ownershipCheck);
		expect(patch.slice(ownershipCheck, parked)).toContain("return;");
		expect(added).not.toContain("this._disconnectRunner1.schedule();");
	});

	test("live unknown processes request a serialized, failure-visible sync", () => {
		expect(added).toContain("this._onDidRequestTerminalSync.fire();");
		expect(added).toContain(
			"this._remoteTerminalSync = sync.catch(error => this._logService.error('Failed to synchronize remote terminals', error));"
		);
		expect(added).toContain("return sync;");
	});

	test("layout expansion checks workspace ownership before attachment", () => {
		expect(added).toContain(
			"persistentProcess.workspaceId !== workspaceId || !persistentProcess.shouldPersistTerminal"
		);
		expect(added).toContain("this._recreateTerminalGroups(layoutInfo, true)");
	});
});
