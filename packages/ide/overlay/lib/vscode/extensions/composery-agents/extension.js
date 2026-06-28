const vscode = require("vscode");

// Keep these ids and logos in sync with welcome.diff.
const AGENTS = [
	{
		id: "claude",
		name: "Claude Code",
		command: "curl -fsSL https://claude.ai/install.sh | bash"
	},
	{
		id: "codex",
		name: "Codex",
		command: "curl -fsSL https://chatgpt.com/codex/install.sh | sh"
	},
	{
		id: "opencode",
		name: "OpenCode",
		command: "curl -fsSL https://opencode.ai/install | bash"
	},
	{
		id: "pi",
		name: "Pi",
		command: "npm install -g @earendil-works/pi-coding-agent"
	},
	{
		id: "openclaw",
		name: "OpenClaw",
		command: "npm install -g openclaw@latest"
	},
	{
		id: "hermes",
		name: "Hermes",
		command: "curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"
	}
];

function run(agent) {
	const terminal = vscode.window.createTerminal(`Set up ${agent.name}`);
	terminal.show();
	terminal.sendText(agent.command);
}

async function pickAgent() {
	const choice = await vscode.window.showQuickPick(
		AGENTS.map((agent) => ({
			label: agent.name,
			detail: agent.command,
			id: agent.id
		})),
		{
			title: "Set up an AI coding agent",
			placeHolder: "Run an agent's official setup command in a new terminal"
		}
	);
	return choice && AGENTS.find((agent) => agent.id === choice.id);
}

function activate(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand("composery.installAgent", async (id) => {
			const agent = AGENTS.find((a) => a.id === id) || (await pickAgent());
			if (agent) {
				run(agent);
			}
		})
	);
}

function deactivate() {}

module.exports = { activate, deactivate };
