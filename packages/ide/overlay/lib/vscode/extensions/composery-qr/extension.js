const os = require("node:os");
const vscode = require("vscode");
const qrcode = require("./qrcode-generator.js");

// Opens an editor tab with a QR of the instance URL. The URL is passed in by the
// workbench command (only the browser knows which of the server's addresses
// reached it), and the QR SVG is generated here in node — no client-side script,
// so nothing can fail to load and render blank.
const COMMAND = "composery.showQr";
const TITLE = "QR Code";

// Module side, so the quiet zone below is expressed in modules like the spec is.
const CELL_SIZE = 8;
// The spec's four-module quiet zone belongs inside the SVG, where it scales with
// the code. Layout padding cannot supply it: a short LAN address makes a version
// 2 code whose modules are wide enough that 20px is worth barely two of them.
const QUIET_ZONE = CELL_SIZE * 4;

// URL parsing canonicalises hosts before we see them (127.1 -> 127.0.0.1,
// ::ffff:127.0.0.1 -> [::ffff:7f00:1]), so exact forms are enough here.
const LOOPBACK_IPV6 = /^\[(::1?|::ffff:(7f[\da-f]{2}:[\da-f]{1,4}|0:0))\]$/;
const IPV4 = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

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

// A QR is only worth showing when the device that scans it can reach the address.
function isReachableFromAnotherDevice(url) {
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return false;
	}
	// Only a fully qualified trailing dot survives canonicalisation.
	const host = url.hostname.replace(/\.$/, "");
	if (host === "localhost" || host.endsWith(".localhost")) {
		return false;
	}
	if (host.startsWith("[")) {
		return !LOOPBACK_IPV6.test(host);
	}
	const ipv4 = IPV4.exec(host);
	if (ipv4) {
		// 127/8 is this machine; 0.0.0.0 is not an address you can dial.
		return ipv4[1] !== "127" && host !== "0.0.0.0";
	}
	return true;
}

// Addresses another device could try instead. A suggestion, never a substitution:
// in a container these are the container's own addresses, and only the reader can
// tell which of them their phone is actually on.
function networkAddresses(url) {
	return [
		...new Set(
			Object.values(os.networkInterfaces())
		.flat()
		.filter((iface) => iface && !iface.internal && iface.family === "IPv4")
			.map((iface) => iface.address)
		)
	]
		// Prefer the ranges normally used by a physical LAN over the 172.16/12
		// range commonly claimed by container bridges.
		.sort((left, right) => networkAddressPriority(left) - networkAddressPriority(right))
		.map((address) => {
			const alternative = new URL(url.href);
			alternative.hostname = address;
			return alternative.href;
		})
		// Bridges and VPNs push this list out; a few candidates is a hint, a
		// dozen is noise.
		.slice(0, 3);
}

function networkAddressPriority(address) {
	if (address.startsWith("192.168.")) return 0;
	if (address.startsWith("10.")) return 1;
	if (/^172\.(1[6-9]|2\d|3[01])\./.test(address)) return 2;
	if (address.startsWith("169.254.")) return 4;
	return 3;
}

function render(url) {
	const qr = qrcode(0, "M");
	qr.addData(url);
	qr.make();
	const svg = qr.createSvgTag({
		cellSize: CELL_SIZE,
		margin: QUIET_ZONE,
		scalable: true,
		// Gives the SVG role="img" and a label; the code itself is unreadable to
		// anything that is not a camera.
		title: `QR code for ${url}`
	});
	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta
			name="viewport"
			content="width=device-width, initial-scale=1, viewport-fit=cover"
		/>
		<meta
			http-equiv="Content-Security-Policy"
			content="default-src 'none'; style-src 'unsafe-inline';"
		/>
		<title>${TITLE}</title>
		<style>
			* {
				box-sizing: border-box;
			}
			html,
			body {
				margin: 0;
			}
			body {
				display: flex;
				align-items: center;
				justify-content: center;
				/* dvh, not a percentage: a percentage min-height never resolves
				   against an auto-height <html>, so the card would hug the top of
				   the tab with the whole viewport empty below it. */
				min-height: 100dvh;
				padding: max(16px, env(safe-area-inset-top, 0px))
					max(16px, env(safe-area-inset-right, 0px))
					max(16px, env(safe-area-inset-bottom, 0px))
					max(16px, env(safe-area-inset-left, 0px));
				overflow: auto;
				font-family: var(--vscode-font-family);
				color: var(--vscode-foreground);
			}
			.card {
				display: flex;
				flex-direction: column;
				align-items: center;
				gap: 16px;
				width: 100%;
				max-width: 360px;
				text-align: center;
			}
			.frame {
				/* Bounded on both axes so no breakpoint has to guess a device size;
				   10rem covers the padding, the gap and a wrapped address. */
				width: min(288px, 100%, calc(100dvh - 10rem));
				aspect-ratio: 1;
				padding: 12px;
				background: #ffffff;
				border-radius: 16px;
			}
			.frame svg {
				display: block;
				width: 100%;
				height: 100%;
			}
			.url {
				margin: 0;
				font-size: 14px;
				word-break: break-all;
				/* One tap takes the whole address, for typing it in by hand. */
				user-select: all;
				-webkit-user-select: all;
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
	// One panel, and one render per address: setting webview.html reloads the
	// iframe, and the address cannot change while the window is open.
	let panel;
	let rendered;

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND, async (value) => {
			let url;
			try {
				url = new URL(typeof value === "string" ? value : "");
			} catch {
				vscode.window.showErrorMessage(
					"Composery could not determine this instance's address."
				);
				return;
			}

			if (!isReachableFromAnotherDevice(url)) {
				const alternatives = networkAddresses(url);
				const selected = await vscode.window.showWarningMessage(
					alternatives.length
						? "This address only works on this device. Try one below. Composery found these addresses on this computer, but cannot tell which one your other device can use."
						: "This address only works on this device. Reopen Composery using this computer's network address, then show the QR code again.",
					...alternatives
				);
				if (selected) {
					await vscode.env.openExternal(vscode.Uri.parse(selected));
				}
				return;
			}

			if (panel) {
				panel.reveal(panel.viewColumn, false);
			} else {
				panel = vscode.window.createWebviewPanel(
					"composeryQr",
					TITLE,
					vscode.ViewColumn.Active,
					{}
				);
				// The panel's own disposal releases this listener; parking it in
				// context.subscriptions would just pile up dead entries.
				panel.onDidDispose(() => {
					panel = undefined;
					rendered = undefined;
				});
			}

			if (rendered !== url.href) {
				try {
					panel.webview.html = render(url.href);
				} catch (error) {
					// The generator throws plain strings (code length overflow).
					panel.dispose();
					vscode.window.showErrorMessage(
						`Composery could not build a QR code for this address: ${String(error)}`
					);
					return;
				}
				rendered = url.href;
			}
		})
	);
}

function deactivate() {}

module.exports = { activate, deactivate };
