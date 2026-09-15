import { describe, expect, test } from "bun:test";
import { AuthorizedKeysFile } from "../../convex/ssh/authorized_keys";

const encode = (text: string) => new TextEncoder().encode(text);
const key = { type: "ssh-ed25519", base64: "AAAA" };
const line = `${key.type} ${key.base64}`;
// A byte that is not valid UTF-8 on its own.
const invalidUtf8Byte = 255;
const carriageReturnByte = 13;
const newlineByte = 10;
const fractionalLine = 1.5;
const lineAfterEnd = 4;
const nonEntryLineCount = 3;
const nonEntryLines = Array.from(
	{ length: nonEntryLineCount },
	(_, index) => index + 1,
);
const sampleCount = 256;
// Numerical Recipes linear congruential generator, so the corpus is the same on every run.
const generatorMultiplier = 1_664_525;
const generatorIncrement = 1_013_904_223;
const byteShift = 24;

test("an unchanged plan preserves arbitrary bytes, including malformed lines", () => {
	const bytes = new Uint8Array([
		...encode(`# comment\r\n${line}\n`),
		invalidUtf8Byte,
		0,
		carriageReturnByte,
	]);
	const file = new AuthorizedKeysFile(bytes);
	expect(file.plan(bytes, [])).toEqual({ ok: true, candidate: bytes });
});

test("an update selects a duplicate occurrence without changing its neighbors", () => {
	const bytes = encode(`restrict ${line} first\r\npty ${line} second\n`);
	const file = new AuthorizedKeysFile(bytes);
	expect(
		file.plan(bytes, [{ kind: "update", line: 2, comment: "changed" }]),
	).toEqual({
		ok: true,
		candidate: encode(`restrict ${line} first\r\npty ${line} changed\n`),
	});
});

test("changing the caller's buffer or a returned copy never changes the file it read", () => {
	const bytes = encode(`${line}\n`);
	const file = new AuthorizedKeysFile(bytes);
	bytes.fill(0);
	file.bytes().fill(0);
	expect(file.bytes()).toEqual(encode(`${line}\n`));
	const plan = file.plan(file.bytes(), []);
	if (!plan.ok) {
		throw new Error(plan.reason);
	}
	plan.candidate.fill(0);
	expect(file.plan(encode(`${line}\n`), [])).toEqual({
		ok: true,
		candidate: encode(`${line}\n`),
	});
});

test("ordered options retain duplicates, case, quoted separators, and backslashes", () => {
	const options = String.raw`restrict,PTY,permitopen="host:22",permitopen="other:80",command="echo \"hello, world\" C:\work",environment="A=1",environment="A=2"`;
	const bytes = encode(`\t${options} \t${line}   café # comment\r\n`);
	const file = new AuthorizedKeysFile(bytes);
	const entry = file.lines[0];
	if (entry?.kind !== "entry") {
		throw new Error("Missing entry");
	}
	expect(entry.entry.options.map((option) => option.name)).toEqual([
		"restrict",
		"PTY",
		"permitopen",
		"permitopen",
		"command",
		"environment",
		"environment",
	]);
	expect(entry.entry.options[4]?.value).toBe('echo "hello, world" C:\\work');
	expect(entry.entry.options.map((option) => option.raw).join(",")).toBe(
		options,
	);
	expect(entry.entry.comment).toBe("café # comment");
	expect(
		file.plan(bytes, [{ kind: "update", line: 1, comment: "new" }]),
	).toEqual({
		ok: true,
		candidate: encode(`\t${options} \t${line} new\r\n`),
	});
});

test("updating options preserves indentation, key whitespace, and comment bytes", () => {
	const bytes = encode(" \trestrict\tssh-ed25519\tAAAA   keep  \n");
	const file = new AuthorizedKeysFile(bytes);
	expect(
		file.plan(bytes, [
			{ kind: "update", line: 1, options: ["pty", "restrict"] },
		]),
	).toEqual({
		ok: true,
		candidate: encode(" \tpty,restrict ssh-ed25519\tAAAA   keep  \n"),
	});
	expect(file.plan(bytes, [{ kind: "update", line: 1, options: [] }])).toEqual({
		ok: true,
		candidate: encode(" \tssh-ed25519\tAAAA   keep  \n"),
	});
});

test("batch targets use original line numbers regardless of request order", () => {
	const bytes = encode(`# keep\n${line} one\n${line} two\n${line} three`);
	const file = new AuthorizedKeysFile(bytes);
	expect(
		file.plan(bytes, [
			{ kind: "update", line: 4, comment: "last" },
			{ kind: "remove", line: 2 },
		]),
	).toEqual({
		ok: true,
		candidate: encode(`# keep\n${line} two\n${line} last`),
	});
});

describe("ambiguous or unsupported edits fail without producing a candidate", () => {
	test("stale contents reject even a request that would otherwise succeed", () => {
		const file = new AuthorizedKeysFile(encode(`${line}\n`));
		expect(
			file.plan(encode(`# changed\n${line}\n`), [{ kind: "remove", line: 1 }]),
		).toEqual({ ok: false, reason: "changed" });
	});
	test.each([
		0,
		-1,
		fractionalLine,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		lineAfterEnd,
	])("invalid line %s", (target) => {
		const file = new AuthorizedKeysFile(encode(`${line}\n`));
		expect(file.plan(file.bytes(), [{ kind: "remove", line: target }])).toEqual(
			{ ok: false, reason: "invalid_target" },
		);
	});
	test.each(nonEntryLines)("non-entry line %s", (target) => {
		const file = new AuthorizedKeysFile(
			encode("# comment\n \t\nunknown content\n"),
		);
		expect(file.plan(file.bytes(), [{ kind: "remove", line: target }])).toEqual(
			{ ok: false, reason: "invalid_target" },
		);
	});
	test("two edits of the same occurrence", () => {
		const file = new AuthorizedKeysFile(encode(`${line}\n`));
		expect(
			file.plan(file.bytes(), [
				{ kind: "update", line: 1, options: ["restrict"] },
				{ kind: "remove", line: 1 },
			]),
		).toEqual({ ok: false, reason: "duplicate_target" });
	});
	test.each(["\nnew entry", "\rnew entry", "\0hidden", "\ud800"])(
		"unsafe comment %j",
		(comment) => {
			const file = new AuthorizedKeysFile(encode(`${line}\n`));
			expect(
				file.plan(file.bytes(), [{ kind: "update", line: 1, comment }]),
			).toEqual({ ok: false, reason: "invalid_edit" });
		},
	);
	test.each([
		'command="unterminated',
		"restrict,pty",
		"",
		"from=unquoted",
		"restrict\n",
		'command="ok"suffix',
	])("invalid option token %j", (option) => {
		const file = new AuthorizedKeysFile(encode(`${line}\n`));
		expect(
			file.plan(file.bytes(), [{ kind: "update", line: 1, options: [option] }]),
		).toEqual({ ok: false, reason: "invalid_edit" });
	});
	test.each([
		{ type: "ssh-ed25519\n", base64: "AAAA" },
		{ type: "ssh-ed25519", base64: "AAAA new" },
		{ type: "ssh-ed25519", base64: "" },
		{ type: "ssh-ed25519", base64: "AA=A" },
	])("a key field that could insert another field or line %j", (invalidKey) => {
		const file = new AuthorizedKeysFile(encode(`${line}\n`));
		expect(
			file.plan(file.bytes(), [{ kind: "update", line: 1, key: invalidKey }]),
		).toEqual({ ok: false, reason: "invalid_edit" });
		expect(
			file.plan(file.bytes(), [
				{ kind: "append", key: invalidKey, options: [], comment: "" },
			]),
		).toEqual({ ok: false, reason: "invalid_edit" });
	});
});

test.each([
	'command="unterminated',
	"from=unquoted",
	'command="ok"suffix',
	'"command"',
])("unrecognized syntax is opaque and preserved: %s", (options) => {
	const bytes = encode(`${options} ${line}\n`);
	const file = new AuthorizedKeysFile(bytes);
	expect(file.lines[0]?.kind).toBe("opaque");
	expect(file.plan(bytes, [])).toEqual({ ok: true, candidate: bytes });
});

test.each([
	"ssh-ed25519",
	"ssh-rsa",
	"ssh-dss",
	"ecdsa-sha2-nistp256",
	"ecdsa-sha2-nistp384",
	"ecdsa-sha2-nistp521",
	"sk-ssh-ed25519@openssh.com",
	"sk-ecdsa-sha2-nistp256@openssh.com",
	"ssh-ed25519-cert-v01@openssh.com",
	"sk-ssh-ed25519-cert-v01@openssh.com",
])("recognizes a key field of type %s without changing it", (type) => {
	const bytes = encode(`cert-authority,principals="a,b" ${type} AAAA\n`);
	const file = new AuthorizedKeysFile(bytes);
	expect(file.lines[0]?.kind).toBe("entry");
	expect(file.plan(bytes, [])).toEqual({ ok: true, candidate: bytes });
});

test.each(["restrict,,pty", "restrict,", ",restrict"])(
	"an empty option does not hide the key that OpenSSH signs in with: %s",
	(options) => {
		const bytes = encode(`${options} ${line} label\n`);
		const file = new AuthorizedKeysFile(bytes);
		const entry = file.lines[0];
		if (entry?.kind !== "entry") {
			throw new Error(`The line was read as ${entry?.kind}.`);
		}
		expect(entry.entry.key).toEqual(key);
		expect(entry.entry.comment).toBe("label");
		expect(file.plan(bytes, [])).toEqual({ ok: true, candidate: bytes });
		expect(file.plan(bytes, [{ kind: "remove", line: 1 }])).toEqual({
			ok: true,
			candidate: new Uint8Array(),
		});
	},
);

test("an option token that would write an empty option is refused", () => {
	const file = new AuthorizedKeysFile(encode(`${line}\n`));
	for (const option of ["restrict,", ",restrict", "restrict,,pty"]) {
		expect(
			file.plan(file.bytes(), [{ kind: "update", line: 1, options: [option] }]),
		).toEqual({ ok: false, reason: "invalid_edit" });
	}
});

test("a key before a NUL is an entry that can be removed but not rewritten, because the rest is invisible", () => {
	const bytes = encode(`${line} visible\0hidden\n# after\n`);
	const file = new AuthorizedKeysFile(bytes);
	const entry = file.lines[0];
	if (entry?.kind !== "entry") {
		throw new Error(`The line was read as ${entry?.kind}.`);
	}
	expect(entry.entry.comment).toBe("visible");
	expect(file.plan(bytes, [{ kind: "remove", line: 1 }])).toEqual({
		ok: true,
		candidate: encode("# after\n"),
	});
	expect(
		file.plan(bytes, [{ kind: "update", line: 1, comment: "renamed" }]),
	).toEqual({ ok: false, reason: "invalid_target" });
});

test("a BOM, an embedded carriage return, an unknown type, and invalid UTF-8 stay opaque", () => {
	const bytes = new Uint8Array([
		...encode(`\ufeff${line}\n${line}\rtail\nssh-future AAAA\n`),
		invalidUtf8Byte,
		newlineByte,
		...encode(`${line}\n`),
	]);
	const file = new AuthorizedKeysFile(bytes);
	expect(file.lines.map((item) => item.kind)).toEqual([
		"opaque",
		"opaque",
		"opaque",
		"opaque",
		"entry",
	]);
	const result = file.plan(bytes, [{ kind: "remove", line: 5 }]);
	expect(result).toEqual({
		ok: true,
		candidate: bytes.slice(0, -(line.length + 1)),
	});
});

test.each([
	["", `${line}\n`],
	["# keep", `# keep\n${line}\n`],
	["# keep\r\n", `# keep\r\n${line}\r\n`],
	[`${line}`, `${line}\n${line}\n`],
])(
	"append preserves content and separates an unterminated last line: %j",
	(before, after) => {
		const file = new AuthorizedKeysFile(encode(before));
		expect(
			file.plan(file.bytes(), [
				{ kind: "append", key, options: [], comment: "" },
			]),
		).toEqual({ ok: true, candidate: encode(after) });
	},
);

test("append after removal does not manufacture an empty first line", () => {
	const file = new AuthorizedKeysFile(encode(line));
	expect(
		file.plan(file.bytes(), [
			{ kind: "remove", line: 1 },
			{ kind: "append", key, options: ["restrict"], comment: "new" },
			{ kind: "append", key, options: [], comment: "second" },
		]),
	).toEqual({
		ok: true,
		candidate: encode(`restrict ${line} new\n${line} second\n`),
	});
});

test("an edit after a line of multibyte characters changes exactly the bytes of its own line", () => {
	const before = "# café 🗝\r\n";
	const file = new AuthorizedKeysFile(encode(`${before}${line} old`));
	expect(
		file.plan(file.bytes(), [{ kind: "update", line: 2, comment: "new" }]),
	).toEqual({ ok: true, candidate: encode(`${before}${line} new`) });
});

test("changing a key retains its existing restrictions and comment", () => {
	const file = new AuthorizedKeysFile(
		encode(`\trestrict,command="backup"\t${line} label\r\n`),
	);
	expect(
		file.plan(file.bytes(), [
			{
				kind: "update",
				line: 1,
				key: { type: "ssh-rsa", base64: "AQAB" },
			},
		]),
	).toEqual({
		ok: true,
		candidate: encode(`\trestrict,command="backup"\tssh-rsa AQAB label\r\n`),
	});
});

test("a no-op update retains all original separators and line endings", () => {
	const bytes = encode(
		`\tpermitopen="a:22",permitopen="b:23"\tssh-ed25519\tAAAA  tail  `,
	);
	const file = new AuthorizedKeysFile(bytes);
	expect(file.plan(bytes, [{ kind: "update", line: 1 }])).toEqual({
		ok: true,
		candidate: bytes,
	});
});

test("arbitrary byte sequences round-trip through the public boundary", () => {
	let seed = 20_260_914;
	for (let sample = 0; sample < sampleCount; sample++) {
		const bytes = Uint8Array.from({ length: sample }, () => {
			seed = (Math.imul(seed, generatorMultiplier) + generatorIncrement) >>> 0;
			return seed >>> byteShift;
		});
		const file = new AuthorizedKeysFile(bytes);
		expect(file.bytes()).toEqual(bytes);
		expect(file.plan(bytes, [])).toEqual({ ok: true, candidate: bytes });
	}
});
