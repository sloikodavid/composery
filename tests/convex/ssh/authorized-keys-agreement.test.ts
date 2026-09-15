import { beforeAll, expect, test } from "bun:test";
import { AuthorizedKeysFile } from "../../../convex/ssh/authorized_keys";
import { discoverSshKeyAcceptance } from "../../../convex/ssh/key_acceptance";
import { generateAuthorizedKey } from "../../harness/keys";
import { quoteShell, type SshdServer, useSshd } from "../../harness/sshd";

const setupTimeoutMs = 300_000;
const testTimeoutMs = 60_000;
// Written as a code point, because the character itself is invisible in source.
const byteOrderMark = 0xfe_ff;

let server: SshdServer;

beforeAll(async () => {
	server = await useSshd();
}, setupTimeoutMs);

type Line = (key: string) => string;

/**
 * Lines whose syntax an editor could read differently from OpenSSH. The parser may call a line an
 * entry that the server then refuses: the panel shows it, and its acceptance says refused. It must
 * never call a line opaque that the server accepts, because the panel could then neither show nor
 * remove a key that signs in.
 */
const lines: Record<string, Line> = {
	"leading whitespace": (key) => ` \t${key}`,
	"doubled separator between type and key": (key) => key.replace(" ", "  "),
	"upper-case option": (key) => `PTY ${key}`,
	"doubled comma between options": (key) => `restrict,,pty ${key}`,
	"trailing comma after options": (key) => `restrict, ${key}`,
	"leading comma before options": (key) => `,restrict ${key}`,
	"options field of only commas": (key) => `,, ${key}`,
	"unquoted option value": (key) => `from=unquoted ${key}`,
	"text after a quoted value": (key) => `command="ok"suffix ${key}`,
	"quoted option name": (key) => `"command" ${key}`,
	"repeated command option": (key) => `command="a",command="b" ${key}`,
	"unknown option": (key) => `future-option="value" ${key}`,
	"byte order mark": (key) => `${String.fromCodePoint(byteOrderMark)}${key}`,
	"carriage return before the newline": (key) => `${key}\r`,
	"NUL inside the line": (key) => `${key}\0tail`,
	"carriage return inside the line": (key) => `${key}\rtail`,
};

/** Writes one line as exact bytes and returns how the parser and the running server each read it. */
async function readBothWays(render: Line) {
	const account = server.createAccount();
	const key = generateAuthorizedKey();
	const bytes = new TextEncoder().encode(
		`${render(`${key.type} ${key.base64}`)}\n`,
	);
	// Exact bytes, including NUL, travel as base64 so no shell reinterprets them.
	server.run(
		`python3 -c 'import base64, sys; open(sys.argv[1], "wb").write(base64.b64decode(sys.argv[2]))' ${quoteShell(account.keyPath)} ${Buffer.from(bytes).toString("base64")}`,
	);
	return {
		kind: new AuthorizedKeysFile(bytes).lines[0]?.kind,
		acceptance: await discoverSshKeyAcceptance(
			{ ...server.connection, username: account.name },
			key,
		),
	};
}

// Without this, a question that always answered "refused" would let every check below pass.
test(
	"the parser and the server agree on a plain key, so the checks below can fail",
	async () => {
		expect(await readBothWays((key) => key)).toEqual({
			kind: "entry",
			acceptance: "accepted",
		});
	},
	testTimeoutMs,
);

for (const [name, render] of Object.entries(lines)) {
	test(
		`a line that the server accepts is an entry to the parser: ${name}`,
		async () => {
			const { kind, acceptance } = await readBothWays(render);
			if (acceptance === "accepted") {
				expect({ name, kind }).toEqual({ name, kind: "entry" });
			}
		},
		testTimeoutMs,
	);
}
