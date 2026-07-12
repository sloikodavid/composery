const vscode = require("vscode");
const qrcode = require("./qrcode-generator.js");

// Opens an editor tab with a QR of the instance URL. The URL is passed in by the
// workbench command (the browser knows its own address; the server/extension host
// does not), and the QR SVG is generated here in node — no client-side script, so
// nothing can fail to load and render blank.
const COMMAND = "composery.showQr";

function escapeHtml(value) {
	return String(value).replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;"
			})[c]
	);
}

function render(url) {
	const qr = qrcode(0, "M");
	qr.addData(url);
	qr.make();
	// margin 0 — the white .frame padding below supplies the quiet zone.
	const svg = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta
			http-equiv="Content-Security-Policy"
			content="default-src 'none'; style-src 'unsafe-inline';"
		/>
		<style>
			* {
				box-sizing: border-box;
			}
			html,
			body {
				min-height: 100%;
				margin: 0;
			}
			body {
				display: flex;
				align-items: center;
				justify-content: center;
				padding: 24px;
				overflow: auto;
				font-family: var(--vscode-font-family);
				color: var(--vscode-foreground);
			}
			.card {
				display: flex;
				flex-direction: column;
				align-items: center;
				gap: 20px;
				width: 100%;
				max-width: 360px;
				text-align: center;
			}
			.frame {
				width: min(288px, 100%);
				aspect-ratio: 1;
				padding: 20px;
				background: #ffffff;
				border-radius: 16px;
			}
			.frame svg {
				display: block;
				width: 100%;
				height: 100%;
			}
			@media (max-width: 335px), (max-height: 430px) {
				body {
					padding: 12px;
				}
				.card {
					gap: 12px;
				}
				.frame {
					width: min(288px, 100%, calc(100vh - 98px));
					padding: 12px;
				}
			}
			.hint {
				margin: 0;
				font-size: 14px;
				opacity: 0.7;
			}
			.url {
				margin: 0;
				font-size: 14px;
				word-break: break-all;
			}
		</style>
	</head>
	<body>
		<div class="card">
			<div class="frame">${svg}</div>
			<p class="url">${escapeHtml(url)}</p>
		</div>
	</body>
</html>`;
}

function activate(context) {
	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND, (url) => {
			const panel = vscode.window.createWebviewPanel(
				"composeryQr",
				"QR Code",
				vscode.ViewColumn.Active,
				{}
			);
			panel.webview.html = render(typeof url === "string" ? url : "");
		})
	);
}

function deactivate() {}

module.exports = { activate, deactivate };
