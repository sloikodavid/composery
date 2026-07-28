import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

import { describe, expect, test } from "vitest";

const extensionPath = resolve(
	import.meta.dirname,
	"../../overlay/lib/vscode/extensions/composery-agents/extension.js"
);
const source = readFileSync(extensionPath, "utf8");

function loadExtension(options?: {
	installed?: string[];
	pick?: string;
	prompt?: string;
	vsix?: Uint8Array;
}) {
	const events: string[] = [];
	const commands: unknown[][] = [];
	const terminals: { name: string; command?: string }[] = [];
	const written: { uri: string; contents: number[] }[] = [];
	let handler: (id?: string) => Promise<void>;
	let items: {
		id: string;
		label: string;
		description: string;
		detail: string;
	}[] = [];

	const vscode = {
		extensions: {
			getExtension(id: string) {
				return options?.installed?.includes(id) ? { id } : undefined;
			}
		},
		window: {
			createTerminal(name: string) {
				const terminal: { name: string; command?: string } = { name };
				terminals.push(terminal);
				return {
					show() {
						events.push(`show:${name}`);
					},
					sendText(command: string) {
						terminal.command = command;
						events.push(`command:${command}`);
					}
				};
			},
			showQuickPick(next: typeof items) {
				items = next;
				return Promise.resolve(next.find((item) => item.id === options?.pick));
			},
			showInformationMessage(message: string) {
				events.push(`prompt:${message}`);
				return Promise.resolve(options?.prompt);
			},
			withProgress(
				_progress: unknown,
				task: () => Promise<unknown>
			): Promise<unknown> {
				return task();
			},
			showErrorMessage(message: string) {
				events.push(`error:${message}`);
			}
		},
		ProgressLocation: { Notification: 15 },
		Uri: {
			joinPath(base: string, path: string) {
				return `${base}/${path}`;
			}
		},
		workspace: {
			fs: {
				createDirectory() {
					return Promise.resolve();
				},
				writeFile(uri: string, contents: Uint8Array) {
					written.push({ uri, contents: Array.from(contents) });
					return Promise.resolve();
				},
				delete(uri: string) {
					events.push(`delete:${uri}`);
					return Promise.resolve();
				}
			}
		},
		commands: {
			registerCommand(_id: string, callback: typeof handler) {
				handler = callback;
				return { dispose() {} };
			},
			executeCommand(...args: unknown[]) {
				commands.push(args);
				events.push(`extension:${String(args[1])}`);
				return Promise.resolve();
			}
		}
	};

	const context = vm.createContext({
		module: { exports: {} },
		exports: {},
		fetch() {
			const contents = options?.vsix ?? new Uint8Array([0x50, 0x4b]);
			return Promise.resolve({
				ok: true,
				status: 200,
				arrayBuffer: () => Promise.resolve(contents.buffer)
			});
		},
		require(id: string) {
			if (id === "vscode") return vscode;
			throw new Error(`Unexpected require: ${id}`);
		}
	});
	vm.runInContext(source, context, { filename: extensionPath });
	const exports = (
		context.module as { exports: { activate(context: object): void } }
	).exports;
	exports.activate({ subscriptions: [], globalStorageUri: "storage" });

	return {
		commands,
		events,
		items: () => items,
		run(id?: string) {
			return handler(id);
		},
		terminals,
		written
	};
}

describe("agent setup", () => {
	const additional = {
		kimi: "curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash",
		grok: "curl -fsSL https://x.ai/cli/install.sh | bash",
		aider: "curl -LsSf https://aider.chat/install.sh | sh",
		droid: "curl -fsSL https://app.factory.ai/cli | sh",
		amp: "curl -fsSL https://ampcode.com/install.sh | bash",
		antigravity: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
		copilot: "curl -fsSL https://gh.io/copilot-install | bash",
		cursor: "curl https://cursor.com/install -fsS | bash",
		kilo: "npm install -g @kilocode/cli"
	};

	test.each(Object.entries(additional))(
		"%s runs its current vendor setup command",
		async (id, command) => {
			const extension = loadExtension();
			await extension.run(id);
			expect(extension.terminals).toHaveLength(1);
			expect(extension.terminals[0]?.name).not.toBe("");
			expect(extension.terminals[0]?.command).toBe(command);
		}
	);

	test("More agents lists exactly the additional agents with owner labels", async () => {
		const extension = loadExtension();
		await extension.run("additional");

		expect(extension.items().map((item) => item.id)).toEqual(
			Object.keys(additional)
		);
		for (const item of extension.items()) {
			expect(item.label).not.toBe("");
			expect(item.description).not.toBe("");
			expect(item.detail).toBe(additional[item.id as keyof typeof additional]);
		}
	});

	test("the CLI starts before an owner-provided extension is offered", async () => {
		const extension = loadExtension({ prompt: "Install" });
		await extension.run("droid");

		expect(extension.events).toEqual([
			"show:Set up Droid CLI",
			"command:curl -fsSL https://app.factory.ai/cli | sh",
			"prompt:Droid CLI also has a VS Code extension. Install it?",
			"extension:Factory.factory-vscode-extension"
		]);
		expect(extension.commands).toEqual([
			[
				"workbench.extensions.installExtension",
				"Factory.factory-vscode-extension"
			]
		]);
	});

	test("dismissal never installs the optional extension", async () => {
		const extension = loadExtension();
		await extension.run("kimi");

		expect(extension.events.at(-1)).toBe(
			"prompt:Kimi Code CLI also has a VS Code extension. Install it?"
		);
		expect(extension.commands).toEqual([]);
	});

	test.each([
		"claude",
		"codex",
		"opencode",
		"kimi",
		"droid",
		"amp",
		"copilot",
		"kilo"
	])("%s offers its owner-provided VS Code extension", async (id) => {
		const extension = loadExtension();
		await extension.run(id);

		expect(extension.events.some((event) => event.startsWith("prompt:"))).toBe(
			true
		);
	});

	test.each([
		"pi",
		"openclaw",
		"hermes",
		"grok",
		"aider",
		"antigravity",
		"cursor"
	])("%s does not offer an unofficial editor integration", async (id) => {
		const extension = loadExtension();
		await extension.run(id);

		expect(extension.events.some((event) => event.startsWith("prompt:"))).toBe(
			false
		);
	});

	test("an existing extension is neither prompted for nor reinstalled", async () => {
		const extension = loadExtension({ installed: ["GitHub.copilot-chat"] });
		await extension.run("copilot");

		expect(extension.events.some((event) => event.startsWith("prompt:"))).toBe(
			false
		);
		expect(extension.commands).toEqual([]);
	});

	test("Kilo installs its current Open VSX release", async () => {
		const extension = loadExtension({ prompt: "Install" });
		await extension.run("kilo");

		expect(extension.commands).toEqual([
			["workbench.extensions.installExtension", "kilocode.kilo-code"]
		]);
	});

	test("Amp installs the official Marketplace VSIX when the user agrees", async () => {
		const vsix = new Uint8Array([0x50, 0x4b, 1, 2, 3]);
		const extension = loadExtension({ prompt: "Install", vsix });
		await extension.run("amp");

		expect(extension.written).toEqual([
			{ uri: "storage/sourcegraph.amp.vsix", contents: Array.from(vsix) }
		]);
		expect(extension.commands).toEqual([
			["workbench.extensions.installExtension", "storage/sourcegraph.amp.vsix"]
		]);
		expect(extension.events.at(-1)).toBe("delete:storage/sourcegraph.amp.vsix");
	});
});
