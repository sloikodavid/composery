const vscode = require("vscode");
const { execFile } = require("child_process");

// A guided front for `composery api key ...` (docs/api.md). The CLI stays the
// single writer of the key store; anyone who can run this command can also open
// the editor terminal, so the authorization boundary is unchanged.
const COMMAND = "composery.manageApiKeys";

function cli(args) {
	return new Promise((resolve, reject) => {
		execFile(
			"composery",
			[...args, "--json"],
			{ timeout: 15000 },
			(error, stdout, stderr) => {
				if (error) {
					reject(
						new Error(
							error.code === "ENOENT"
								? "The composery CLI is not available on this instance."
								: String(stderr || error.message).trim()
						)
					);
					return;
				}
				try {
					resolve(JSON.parse(stdout));
				} catch (parseError) {
					reject(parseError);
				}
			}
		);
	});
}

async function createKey() {
	const name = await vscode.window.showInputBox({
		title: "Create API Key",
		prompt: "A label for what will use this key",
		placeHolder: "ci",
		validateInput: (value) => (value.trim() ? undefined : "Enter a name")
	});
	if (name === undefined) {
		return;
	}
	const created = await cli(["api", "key", "create", "--name", name.trim()]);
	const copy = "Copy Key";
	const choice = await vscode.window.showInformationMessage(
		`Created API key "${created.name}"`,
		{
			modal: true,
			detail: `${created.secret}\n\nThis key is shown only once and cannot be recovered. Callers send it in an Authorization: Bearer header.`
		},
		copy
	);
	if (choice === copy) {
		await vscode.env.clipboard.writeText(created.secret);
	}
}

async function revokeKey(key) {
	const revoke = "Revoke";
	const choice = await vscode.window.showWarningMessage(
		`Revoke API key "${key.name}"?`,
		{
			modal: true,
			detail: "Anything still using this key stops working immediately."
		},
		revoke
	);
	if (choice === revoke) {
		await cli(["api", "key", "revoke", key.id]);
	}
}

async function manageKeys() {
	for (;;) {
		const { keys } = await cli(["api", "key", "list"]);
		const create = { label: "$(add) Create API Key" };
		const choice = await vscode.window.showQuickPick(
			[
				create,
				...keys.map((key) => ({
					label: key.name,
					description: `${key.prefix}...`,
					detail: `Created ${new Date(key.created_at * 1000).toISOString().slice(0, 10)}`,
					key
				}))
			],
			{
				title: "API Keys",
				placeHolder: keys.length
					? "Create a key, or pick one to revoke"
					: "No API keys yet - create one to enable the API"
			}
		);
		if (!choice) {
			return;
		}
		if (choice === create) {
			await createKey();
		} else {
			await revokeKey(choice.key);
		}
	}
}

// API terminals are tmux sessions (see routes/api/session.ts), so the editor
// attaches to the same pty instead of opening a parallel one. `=` forces an
// exact tmux target match.
const SESSION_LABEL = "@composery_cmd";
const LIST_FORMAT = `#{session_name}\t#{${SESSION_LABEL}}\t#{pane_current_command}`;
const POLL_MS = 5000;
const MAX_TITLE = 40;

function attachOptions(session) {
	return {
		name: session.title,
		shellPath: "tmux",
		shellArgs: ["attach-session", "-t", `=${session.name}`],
		iconPath: new vscode.ThemeIcon("plug")
	};
}

function listSessions() {
	return new Promise((resolve) => {
		execFile("tmux", ["ls", "-F", LIST_FORMAT], { timeout: 5000 }, (error, stdout) =>
			resolve(
				error
					? []
					: stdout
							.split("\n")
							.filter(Boolean)
							.map((line) => {
								const [name, apiCommand, running] = line.split("\t");
								return {
									name,
									apiCommand,
									// What the tab says. The command the API was asked to run
									// beats the process currently in the pane, which beats the
									// generated session name - "pnpm build", not "api-1a2b3c4d".
									title: (apiCommand || running || name)
										.trim()
										.slice(0, MAX_TITLE)
								};
							})
			)
		);
	});
}

// Terminals the API opened appear as tabs on their own - listed, never focused,
// the way VS Code surfaces terminals that survived a reload. There is no concept
// here for the user to learn: a command ran somewhere, and its terminal is a tab.
// Only sessions carrying the API's label are shown, so a tmux session someone
// started by hand is left where they put it.
function watchTerminals(context) {
	const opened = new Map();
	const poll = async () => {
		const found = await listSessions();
		const live = new Set(found.map((session) => session.name));
		for (const name of [...opened.keys()]) {
			if (!live.has(name)) opened.delete(name);
		}
		for (const session of found) {
			if (!session.apiCommand || opened.has(session.name)) continue;
			opened.set(session.name, vscode.window.createTerminal(attachOptions(session)));
		}
	};
	const timer = setInterval(poll, POLL_MS);
	context.subscriptions.push(
		{ dispose: () => clearInterval(timer) },
		// Closing the tab kills the command, the way closing any terminal does.
		// Closing it only kills `tmux attach-session` - that detaches and leaves
		// the command running - so the session has to be stopped explicitly, or a
		// closed tab would silently reappear on the next poll.
		vscode.window.onDidCloseTerminal((closed) => {
			for (const [name, terminal] of opened) {
				// The map entry is left for the poll above to clear once tmux
				// confirms the session is gone; dropping it here would race the kill
				// and reopen the tab.
				if (terminal === closed) execFile("tmux", ["kill-session", "-t", `=${name}`], () => {});
			}
		})
	);
	void poll();
}

function activate(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND, async () => {
			// Same 1/true semantics as the server's config.ts disabled().
			const off = (process.env.COMPOSERY_DISABLE_API || "")
				.trim()
				.toLowerCase();
			if (off === "1" || off === "true") {
				vscode.window.showWarningMessage(
					"The API is disabled (COMPOSERY_DISABLE_API=true). Keys can be managed, but every API request will return 404."
				);
			}
			try {
				await manageKeys();
			} catch (error) {
				vscode.window.showErrorMessage(`API keys: ${error.message}`);
			}
		})
	);
	watchTerminals(context);
}

function deactivate() {}

module.exports = { activate, deactivate };
