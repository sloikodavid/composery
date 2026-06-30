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
			html,
			body {
				height: 100%;
				margin: 0;
			}
			body {
				display: flex;
				align-items: center;
				justify-content: center;
				box-sizing: border-box;
				padding: 24px;
				font-family: var(--vscode-font-family);
				color: var(--vscode-foreground);
			}
			.card {
				display: flex;
				flex-direction: column;
				align-items: center;
				gap: 20px;
				max-width: 360px;
				text-align: center;
			}
			.frame {
				box-sizing: content-box;
				width: 248px;
				height: 248px;
				padding: 20px;
				background: #ffffff;
				border-radius: 16px;
			}
			.frame svg {
				display: block;
				width: 100%;
				height: 100%;
			}
			.hint {
				margin: 0;
				font-size: 14px;
				opacity: 0.7;
			}
			.url {
				margin: 0;
				font-size: 13px;
				word-break: break-all;
				opacity: 0.55;
			}
		</style>
	</head>
	<body>
		<div class="card">
			<div class="frame">${svg}</div>
			<p class="hint">Scan with the Composery app to add this instance.</p>
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
