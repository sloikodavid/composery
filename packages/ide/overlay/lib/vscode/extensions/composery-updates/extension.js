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

async function checkForUpdates() {
	if (!STABLE.test(CURRENT_VERSION)) return { type: "development" };
	if (!REPO) return { type: "unavailable" };
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
		if (!response.ok) return { type: "unavailable" };

		const release = await response.json();
		const tag = String(release.tag_name || "").replace(/^v/, "");
		if (!STABLE.test(tag) || release.prerelease || !release.html_url) {
			return { type: "unavailable" };
		}
		return isNewer(tag, CURRENT_VERSION)
			? { type: "available", version: tag, url: release.html_url }
			: { type: "current" };
	} catch {
		return { type: "unavailable" };
	}
}

let checking = false;

async function runCheck(manual) {
	if (checking) return;
	checking = true;
	try {
		const result = await checkForUpdates();

		if (result.type === "available") {
			const action = await vscode.window.showInformationMessage(
				`Composery ${result.version} is available. You have ${CURRENT_VERSION}.`,
				"View Release"
			);
			if (action === "View Release") {
				await vscode.env.openExternal(vscode.Uri.parse(result.url));
			}
		} else if (manual) {
			if (result.type === "current") {
				await vscode.window.showInformationMessage(
					`Composery ${CURRENT_VERSION} is up to date.`
				);
			} else if (result.type === "development") {
				const version = CURRENT_VERSION === "unknown"
					? "This development build has no release version."
					: `You have development build ${CURRENT_VERSION}.`;
				await vscode.window.showInformationMessage(
					`${version} Updates are checked automatically in stable releases.`
				);
			} else {
				await vscode.window.showWarningMessage(
					`Couldn't check for updates. You have Composery ${CURRENT_VERSION}. Try again later.`
				);
			}
		}
	} finally {
		checking = false;
	}
}

function activate(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand("composery.checkForUpdates", () => {
			void runCheck(true);
		})
	);

	void runCheck(false);
}

function deactivate() {}

module.exports = { activate, deactivate };
