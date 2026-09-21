import { beforeAll, expect, test } from "bun:test";
import { discoverSshKeyAcceptance } from "../../../../convex/ssh/key_acceptance";
import { generateSshKeyPair } from "../../../../convex/ssh/key_pair";
import { renderSshBootstrapScript } from "../../../../convex/ssh/scripts/bootstrap";
import { reportHostKeyScript } from "../../../../convex/ssh/scripts/report_host_key";
import { quoteShell } from "../../../../convex/ssh/scripts/shell";
import { type SshdServer, useSshd } from "../../../../harness/openssh/sshd";

const setupTimeoutMs = 300_000;
const testTimeoutMs = 60_000;
const unreachableReportUrl = "https://127.0.0.1:1/ssh/host-keys";
// The report fails after the key-file edit, so the test inspects the partial real outcome.
const tokenLength = 43;
const token = "a".repeat(tokenLength);
const processIdPattern = /^\d+$/;

let server: SshdServer;

beforeAll(async () => {
	server = await useSshd();
}, setupTimeoutMs);

function toKey(publicKey: string) {
	const [type, base64] = publicKey.split(" ");
	return { type: type ?? "", base64: base64 ?? "" };
}

async function withBootstrapReport<T>(
	home: string,
	beforeReply: string,
	run: (url: string) => Promise<T>,
) {
	const portFile = `${home}/bootstrap-report-port`;
	const callback = `import http.server, pathlib
class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
${beforeReply
	.split("\n")
	.map((line) => `        ${line}`)
	.join("\n")}
        self.send_response(204)
        self.end_headers()
    def log_message(self, format, *args):
        pass
server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
pathlib.Path(${JSON.stringify(portFile)}).write_text(str(server.server_port))
server.serve_forever()`;
	const pid = server
		.run(
			`python3 -c ${quoteShell(callback)} </dev/null >${quoteShell(`${home}/bootstrap-report-log`)} 2>&1 & echo $!`,
		)
		.trim();
	if (!processIdPattern.test(pid)) {
		throw new Error("The bootstrap report server returned no process ID.");
	}
	try {
		const wait = `import pathlib, time
path = pathlib.Path(${JSON.stringify(portFile)})
deadline = time.monotonic() + 10
while not path.exists():
    if time.monotonic() >= deadline:
        raise SystemExit("The bootstrap report server did not start.")
    time.sleep(0.01)
print(path.read_text())`;
		const port = server.run(`python3 -c ${quoteShell(wait)}`).trim();
		return await run(`http://127.0.0.1:${port}/report`);
	} finally {
		server.run(`kill ${pid} 2>/dev/null || true`);
	}
}

test(
	"a failed renewal report keeps the old key and stages the new key",
	async () => {
		const account = server.createAccount();
		const previous = generateSshKeyPair();
		const next = generateSshKeyPair();
		const personal = generateSshKeyPair();
		server.run(
			`printf '%s\n' ${quoteShell(`${previous.publicKey} composery`)} ${quoteShell(`${personal.publicKey} someone`)} > ${account.keyPath}`,
		);

		const script = renderSshBootstrapScript({
			bootstrapFile: {
				allocationId: "allocation",
				token,
				url: unreachableReportUrl,
			},
			publicKey: next.publicKey,
			previousPublicKey: previous.publicKey,
		});
		server.run(
			`su -s /bin/sh -c ${quoteShell(script)} ${account.name} || true`,
		);

		const ask = (publicKey: string) =>
			discoverSshKeyAcceptance(
				{ ...server.connection, username: account.name },
				toKey(publicKey),
			);
		expect(await ask(next.publicKey)).toBe("accepted");
		// Registration failed, so the old key remains usable while the new key is
		// staged. A later run can retry registration without locking the owner out.
		expect(await ask(previous.publicKey)).toBe("accepted");
		expect(await ask(personal.publicKey)).toBe("accepted");
	},
	testTimeoutMs,
);

test(
	"a second run of the same renewal leaves one copy of the new key",
	() => {
		const account = server.createAccount();
		const previous = generateSshKeyPair();
		const next = generateSshKeyPair();
		server.run(
			`printf '%s\n' ${quoteShell(`${previous.publicKey} composery`)} > ${account.keyPath}`,
		);
		const script = renderSshBootstrapScript({
			bootstrapFile: {
				allocationId: "allocation",
				token,
				url: unreachableReportUrl,
			},
			publicKey: next.publicKey,
			previousPublicKey: previous.publicKey,
		});
		const run = () =>
			server.run(
				`su -s /bin/sh -c ${quoteShell(script)} ${account.name} || true`,
			);
		run();
		run();

		expect(
			server
				.run(
					`grep -c ${quoteShell(next.publicKey.split(" ")[1] ?? "")} ${account.keyPath}`,
				)
				.trim(),
		).toBe("1");
	},
	testTimeoutMs,
);

test(
	"removes the old key only after a successful report and can run again",
	async () => {
		const account = server.createAccount();
		const previous = generateSshKeyPair();
		const next = generateSshKeyPair();
		server.run(
			`printf '%s\\n' ${quoteShell(`${previous.publicKey} composery`)} > ${account.keyPath}`,
		);
		await withBootstrapReport(account.home, "pass", async (url) => {
			const script = renderSshBootstrapScript({
				bootstrapFile: {
					allocationId: "allocation",
					token,
					url,
				},
				publicKey: next.publicKey,
				previousPublicKey: previous.publicKey,
			});
			server.run(`su -s /bin/sh -c ${quoteShell(script)} ${account.name}`);
			const ask = (publicKey: string) =>
				discoverSshKeyAcceptance(
					{ ...server.connection, username: account.name },
					toKey(publicKey),
				);
			expect(await ask(next.publicKey)).toBe("accepted");
			expect(await ask(previous.publicKey)).toBe("refused");
			server.run(`su -s /bin/sh -c ${quoteShell(script)} ${account.name}`);
			expect(
				server
					.run(
						`grep -c ${quoteShell(next.publicKey.split(" ")[1] ?? "")} ${account.keyPath}`,
					)
					.trim(),
			).toBe("1");
		});
	},
	testTimeoutMs,
);

test(
	"finds a renamed configured Ed25519 host key and a key file with spaces",
	async () => {
		const account = server.createAccount();
		const previous = generateSshKeyPair();
		const next = generateSshKeyPair();
		const customPath = `${account.home}/.ssh/key % file`;
		server.run(
			`printf '%s\\n' ${quoteShell(`${previous.publicKey} composery`)} > ${quoteShell(customPath)}`,
		);
		server.run(
			"cp /etc/ssh/ssh_host_ed25519_key /tmp/composery-renamed-host && cp /etc/ssh/ssh_host_ed25519_key.pub /tmp/composery-renamed-host.pub && chmod 644 /tmp/composery-renamed-host.pub",
		);
		const script = renderSshBootstrapScript({
			bootstrapFile: {
				allocationId: "allocation",
				token,
				url: unreachableReportUrl,
			},
			publicKey: next.publicKey,
			previousPublicKey: previous.publicKey,
		});
		await server.withSettingOnDisk(
			`HostKey /tmp/composery-renamed-host\nAuthorizedKeysFile "${customPath}"`,
			() => Promise.resolve(server.run(`sh -c ${quoteShell(script)} || true`)),
		);
		expect(
			server
				.run(`grep -c ${quoteShell(next.publicKey)} ${quoteShell(customPath)}`)
				.trim(),
		).toBe("1");
	},
	testTimeoutMs,
);

test(
	"creates a missing configured key file after an OS reinstall",
	async () => {
		const account = server.createAccount();
		const previous = generateSshKeyPair();
		const next = generateSshKeyPair();
		const missingPath = `${account.home}/.ssh/reinstalled-authorized-keys`;
		server.run(`rm -f ${quoteShell(missingPath)}`);
		const script = renderSshBootstrapScript({
			bootstrapFile: {
				allocationId: "allocation",
				token,
				url: unreachableReportUrl,
			},
			publicKey: next.publicKey,
			previousPublicKey: previous.publicKey,
		});
		await server.withSettingOnDisk(`AuthorizedKeysFile ${missingPath}`, () =>
			Promise.resolve(server.run(`sh -c ${quoteShell(script)} || true`)),
		);

		expect(
			server.run(`test -f ${quoteShell(missingPath)} && printf yes`).trim(),
		).toBe("yes");
		expect(
			server
				.run(`grep -c ${quoteShell(next.publicKey)} ${quoteShell(missingPath)}`)
				.trim(),
		).toBe("1");
	},
	testTimeoutMs,
);

test(
	"keeps both keys when the owner edits the file after registration",
	async () => {
		const account = server.createAccount();
		const previous = generateSshKeyPair();
		const next = generateSshKeyPair();
		server.run(
			`printf '%s\\n' ${quoteShell(`${previous.publicKey} composery`)} > ${account.keyPath}`,
		);
		const beforeReply = `with open(${JSON.stringify(account.keyPath)}, "ab") as handle:
    handle.write(b"# owner edit\\n")`;
		await withBootstrapReport(account.home, beforeReply, (url) => {
			const script = renderSshBootstrapScript({
				bootstrapFile: {
					allocationId: "allocation",
					token,
					url,
				},
				publicKey: next.publicKey,
				previousPublicKey: previous.publicKey,
			});
			server.run(
				`su -s /bin/sh -c ${quoteShell(script)} ${account.name} || true`,
			);

			expect(
				server
					.run(`grep -c ${quoteShell(previous.publicKey)} ${account.keyPath}`)
					.trim(),
			).toBe("1");
			expect(
				server
					.run(`grep -c ${quoteShell(next.publicKey)} ${account.keyPath}`)
					.trim(),
			).toBe("1");
			expect(
				server
					.run(`grep -c ${quoteShell("# owner edit")} ${account.keyPath}`)
					.trim(),
			).toBe("1");
			return Promise.resolve();
		});
	},
	testTimeoutMs,
);

test(
	"initial registration reads a configured host key whose name has spaces",
	async () => {
		const account = server.createAccount();
		const hostPath = `${account.home}/host identity`;
		server.run(
			`cp /etc/ssh/ssh_host_ed25519_key ${quoteShell(hostPath)} && cp /etc/ssh/ssh_host_ed25519_key.pub ${quoteShell(`${hostPath}.pub`)}`,
		);
		await withBootstrapReport(account.home, "pass", (url) =>
			server.withSettingOnDisk(`HostKey "${hostPath}"`, () => {
				const config = JSON.stringify({
					allocationId: "allocation",
					token,
					url,
				});
				server.run(
					`printf '%s' ${quoteShell(config)} > /run/composery-bootstrap.json`,
				);
				server.run(`python3 -I -c ${quoteShell(reportHostKeyScript)}`);
				expect(
					server
						.run("test ! -e /run/composery-bootstrap.json && printf removed")
						.trim(),
				).toBe("removed");
				return Promise.resolve();
			}),
		);
	},
	testTimeoutMs,
);
