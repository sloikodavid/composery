const vscode = require("vscode");

// Both are injected into the runtime image (Dockerfile ENV) and reach the
// extension host in either init mode (systemd bridges COMPOSERY_* into
// /run/composery.env; supervisor inherits the container env directly).
const CURRENT_VERSION = process.env.COMPOSERY_BUILD_VERSION?.trim() || "unknown";
// e.g. "https://github.com/sloikodavid/composery" -> "sloikodavid/composery".
const REPO = (process.env.COMPOSERY_BUILD_SOURCE || "").match(
	/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/
)?.[1];

// Only plain X.Y.Z builds are release-comparable. Preview builds are
// "preview-<sha>" and unreleased dev builds are "unknown" - we never publish a
// GitHub release for those, so an update check would only ever produce noise.
const STABLE = /^\d+\.\d+\.\d+$/;

function isNewer(latest, current) {
	const parts = (v) => v.split(".").map((n) => parseInt(n, 10) || 0);
	const [a, b, c] = parts(latest);
	const [x, y, z] = parts(current);
	if (a !== x) return a > x;
	if (b !== y) return b > y;
	return c > z;
}

// Returns the release { version, url } when a newer stable exists, "up-to-date"
// when the check ran and nothing is newer, or null when it was skipped/failed
// (preview build, no repo, network error) - callers stay silent on null.
async function checkForUpdates() {
	if (!REPO || !STABLE.test(CURRENT_VERSION)) return null;
	try {
		const response = await fetch(
			`https://api.github.com/repos/${REPO}/releases/latest`,
			{
				headers: {
					Accept: "application/vnd.github+json",
					"User-Agent": "composery-updates"
				},
				signal: AbortSignal.timeout(10_000)
			}
		);
		if (!response.ok) return null;

		const release = await response.json();
		const tag = String(release.tag_name || "").replace(/^v/, "");
		if (!STABLE.test(tag) || release.prerelease || !release.html_url) {
			return null;
		}
		return isNewer(tag, CURRENT_VERSION)
			? { version: tag, url: release.html_url }
			: "up-to-date";
	} catch {
		return null;
	}
}

let checking = false;

async function runCheck(statusBar, manual) {
	if (checking) return;
	checking = true;
	try {
		const result = await checkForUpdates();

		if (result && result !== "up-to-date") {
			statusBar.text = `$(arrow-up) ${CURRENT_VERSION}`;
			statusBar.tooltip = `Composery ${result.version} is available - click to view the release`;

			const action = await vscode.window.showInformationMessage(
				`Composery ${result.version} is available.`,
				"View Release"
			);
			if (action === "View Release") {
				await vscode.env.openExternal(vscode.Uri.parse(result.url));
			}
		} else if (manual) {
			// Only speak up for a manual check; the startup check stays quiet.
			await vscode.window.showInformationMessage(
				result === "up-to-date"
					? `Composery ${CURRENT_VERSION} is up to date.`
					: `Composery ${CURRENT_VERSION} - update checks run on stable releases only.`
			);
		}
	} finally {
		checking = false;
	}
}

function activate(context) {
	const statusBar = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		1
	);
	statusBar.text = CURRENT_VERSION;
	statusBar.tooltip = "Check for Updates";
	statusBar.command = "composery.checkForUpdates";
	statusBar.show();

	context.subscriptions.push(
		statusBar,
		vscode.commands.registerCommand("composery.checkForUpdates", () => {
			void runCheck(statusBar, true);
		})
	);

	void runCheck(statusBar, false);
}

function deactivate() {}

module.exports = { activate, deactivate };
