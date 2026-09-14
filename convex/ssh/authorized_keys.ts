/**
 * Lossless file observations and candidate edits, without I/O or authorization.
 * Recognizing an entry's fields does not validate its key blob, option values,
 * or acceptance by sshd. Native validation must precede any remote write.
 */
export type AuthorizedKey = Readonly<{ type: string; base64: string }>;
export type AuthorizedKeyOption = Readonly<{
	name: string;
	value: string | null;
	raw: string;
}>;
export type AuthorizedKeyEntry = Readonly<{
	key: AuthorizedKey;
	options: readonly AuthorizedKeyOption[];
	comment: string;
}>;
export type AuthorizedKeysLine = Readonly<
	{
		/** One-based occurrence within this observation, never a durable identity. */
		line: number;
		start: number;
		end: number;
		ending: "\n" | "\r\n" | "";
	} & (
		| { kind: "entry"; entry: AuthorizedKeyEntry }
		| { kind: "blank" | "comment" }
		| { kind: "opaque"; reason: "encoding" | "syntax" }
	)
>;
export type AuthorizedKeysEdit =
	| { kind: "remove"; line: number }
	| {
			kind: "update";
			line: number;
			key?: AuthorizedKey;
			/** Complete ordered option tokens, including quotes. */
			options?: readonly string[];
			comment?: string;
	  }
	| {
			kind: "append";
			key: AuthorizedKey;
			options: readonly string[];
			comment: string;
	  };
export type AuthorizedKeysPlan =
	| { ok: true; candidate: Uint8Array }
	| {
			ok: false;
			reason:
				| "changed"
				| "invalid_target"
				| "duplicate_target"
				| "invalid_edit";
	  };

const encoder = new TextEncoder();
// Keep a BOM visible so it cannot silently turn into an active entry.
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const keyTypes = new Set([
	"ssh-rsa",
	"ssh-dss",
	"ssh-ed25519",
	"ecdsa-sha2-nistp256",
	"ecdsa-sha2-nistp384",
	"ecdsa-sha2-nistp521",
	"sk-ssh-ed25519@openssh.com",
	"sk-ecdsa-sha2-nistp256@openssh.com",
	"ssh-rsa-cert-v01@openssh.com",
	"ssh-dss-cert-v01@openssh.com",
	"ssh-ed25519-cert-v01@openssh.com",
	"ecdsa-sha2-nistp256-cert-v01@openssh.com",
	"ecdsa-sha2-nistp384-cert-v01@openssh.com",
	"ecdsa-sha2-nistp521-cert-v01@openssh.com",
	"sk-ssh-ed25519-cert-v01@openssh.com",
	"sk-ecdsa-sha2-nistp256-cert-v01@openssh.com",
]);

type Fields = {
	entry: AuthorizedKeyEntry;
	keyStart: number;
	keyEnd: number;
	start: number;
};

function space(char: string | undefined) {
	return char === " " || char === "\t";
}

/** Scan one field; only backslash followed by a quote escapes a quote. */
function fieldEnd(text: string, start: number) {
	let quoted = false;
	let index = start;
	for (; index < text.length; index++) {
		if (text[index] === "\\" && text[index + 1] === '"') {
			index++;
		} else if (text[index] === '"') {
			quoted = !quoted;
		} else if (!quoted && space(text[index])) {
			break;
		}
	}
	return quoted ? -1 : index;
}

function parseOptions(text: string): readonly AuthorizedKeyOption[] | null {
	if (!text) return Object.freeze([]);
	const options: AuthorizedKeyOption[] = [];
	let index = 0;
	while (index < text.length) {
		const start = index;
		while (index < text.length && /[a-zA-Z0-9-]/.test(text[index] ?? ""))
			index++;
		if (start === index) return null;
		const name = text.slice(start, index);
		let value: string | null = null;
		if (text[index] === "=") {
			if (text[++index] !== '"') return null;
			index++;
			value = "";
			while (index < text.length && text[index] !== '"') {
				if (text[index] === "\\" && text[index + 1] === '"') index++;
				value += text[index++];
			}
			if (text[index++] !== '"') return null;
		}
		options.push(Object.freeze({ name, value, raw: text.slice(start, index) }));
		if (index === text.length) break;
		if (text[index++] !== "," || index === text.length) return null;
	}
	return Object.freeze(options);
}

function parseFields(text: string): Fields | null {
	if (text.includes("\0") || text.includes("\r") || text.includes("\n"))
		return null;
	let start = 0;
	while (space(text[start])) start++;
	let keyStart = start;
	let end = fieldEnd(text, start);
	if (end < 0) return null;
	let type = text.slice(start, end);
	let options: readonly AuthorizedKeyOption[] = Object.freeze([]);
	if (!keyTypes.has(type)) {
		const parsed = parseOptions(type);
		if (!parsed) return null;
		options = parsed;
		keyStart = end;
		while (space(text[keyStart])) keyStart++;
		end = fieldEnd(text, keyStart);
		if (end < 0) return null;
		type = text.slice(keyStart, end);
	}
	if (!keyTypes.has(type) || !space(text[end])) return null;
	let blobStart = end;
	while (space(text[blobStart])) blobStart++;
	let keyEnd = blobStart;
	while (keyEnd < text.length && !space(text[keyEnd])) keyEnd++;
	const base64 = text.slice(blobStart, keyEnd);
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
	let commentStart = keyEnd;
	while (space(text[commentStart])) commentStart++;
	return {
		start,
		keyStart,
		keyEnd,
		entry: Object.freeze({
			key: Object.freeze({ type, base64 }),
			options,
			comment: text.slice(commentStart),
		}),
	};
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
	return (
		left.length === right.length &&
		left.every((byte, index) => byte === right[index])
	);
}

function joinBytes(parts: readonly Uint8Array[]) {
	const bytes = new Uint8Array(
		parts.reduce((size, part) => size + part.length, 0),
	);
	let offset = 0;
	for (const part of parts) {
		bytes.set(part, offset);
		offset += part.length;
	}
	return bytes;
}

function validText(text: string) {
	// TextEncoder replaces lone surrogates. Reject rather than change the input.
	return (
		!/[\0\r\n]/.test(text) && decoder.decode(encoder.encode(text)) === text
	);
}

function renderKey(key: AuthorizedKey) {
	if (!keyTypes.has(key.type) || !/^[A-Za-z0-9+/]+={0,2}$/.test(key.base64))
		return null;
	return `${key.type} ${key.base64}`;
}

function renderOptions(options: readonly string[]) {
	for (const option of options) {
		if (!validText(option) || parseOptions(option)?.length !== 1) return null;
	}
	return options.length ? `${options.join(",")} ` : "";
}

/** A copied observation of one concrete file. It contains no remote path or identity. */
export class AuthorizedKeysFile {
	readonly lines: readonly AuthorizedKeysLine[];
	readonly #bytes: Uint8Array;
	readonly #text: readonly (string | null)[];

	constructor(bytes: Uint8Array) {
		this.#bytes = Uint8Array.from(bytes);
		const lines: AuthorizedKeysLine[] = [];
		const texts: (string | null)[] = [];
		let start = 0;
		while (start < this.#bytes.length) {
			const newline = this.#bytes.indexOf(10, start);
			const end = newline < 0 ? this.#bytes.length : newline + 1;
			const ending =
				newline < 0 ? "" : this.#bytes[newline - 1] === 13 ? "\r\n" : "\n";
			const base = { line: lines.length + 1, start, end, ending } as const;
			let text: string | null;
			try {
				text = decoder.decode(this.#bytes.subarray(start, end - ending.length));
			} catch {
				text = null;
			}
			texts.push(text);
			if (text === null) {
				lines.push(
					Object.freeze({ ...base, kind: "opaque", reason: "encoding" }),
				);
			} else if (/^[ \t]*$/.test(text)) {
				lines.push(Object.freeze({ ...base, kind: "blank" }));
			} else if (/^[ \t]*#/.test(text)) {
				lines.push(Object.freeze({ ...base, kind: "comment" }));
			} else {
				const fields = parseFields(text);
				lines.push(
					Object.freeze(
						fields
							? { ...base, kind: "entry", entry: fields.entry }
							: { ...base, kind: "opaque", reason: "syntax" },
					),
				);
			}
			start = end;
		}
		this.lines = Object.freeze(lines);
		this.#text = texts;
		Object.freeze(this);
	}

	/** Return a copy; mutations cannot change the observation. */
	bytes() {
		return Uint8Array.from(this.#bytes);
	}

	/**
	 * Compare supplied bytes and plan edits against original line numbers.
	 * This comparison is neither remote CAS nor an operation retry receipt.
	 * The caller must bind both observations to the same remote file.
	 */
	plan(
		current: Uint8Array,
		edits: readonly AuthorizedKeysEdit[],
	): AuthorizedKeysPlan {
		if (!sameBytes(this.#bytes, current))
			return { ok: false, reason: "changed" };
		const changes = new Map<number, Uint8Array>();
		const appended: Uint8Array[] = [];
		const ending = this.lines.find((line) => line.ending)?.ending || "\n";
		for (const edit of edits) {
			if (edit.kind === "append") {
				const key = renderKey(edit.key);
				const options = renderOptions(edit.options);
				if (key === null || options === null || !validText(edit.comment)) {
					return { ok: false, reason: "invalid_edit" };
				}
				appended.push(
					encoder.encode(
						`${options}${key}${edit.comment ? ` ${edit.comment}` : ""}${ending}`,
					),
				);
				continue;
			}
			const line = this.lines[edit.line - 1];
			if (!Number.isSafeInteger(edit.line) || !line || line.kind !== "entry") {
				return { ok: false, reason: "invalid_target" };
			}
			if (changes.has(edit.line))
				return { ok: false, reason: "duplicate_target" };
			if (edit.kind === "remove") {
				changes.set(edit.line, new Uint8Array());
				continue;
			}
			const text = this.#text[edit.line - 1];
			const fields =
				text === null || text === undefined ? null : parseFields(text);
			if (!fields || text === null || text === undefined)
				return { ok: false, reason: "invalid_target" };
			const options =
				edit.options === undefined
					? text.slice(fields.start, fields.keyStart)
					: renderOptions(edit.options);
			const key =
				edit.key === undefined
					? text.slice(fields.keyStart, fields.keyEnd)
					: renderKey(edit.key);
			if (
				options === null ||
				key === null ||
				(edit.comment !== undefined && !validText(edit.comment))
			) {
				return { ok: false, reason: "invalid_edit" };
			}
			const comment =
				edit.comment === undefined
					? text.slice(fields.keyEnd)
					: edit.comment
						? ` ${edit.comment}`
						: "";
			changes.set(
				edit.line,
				encoder.encode(
					`${text.slice(0, fields.start)}${options}${key}${comment}${line.ending}`,
				),
			);
		}
		const parts = this.lines.map(
			(line) =>
				changes.get(line.line) ?? this.#bytes.subarray(line.start, line.end),
		);
		if (appended.length) {
			const last = parts.findLast((part) => part.length > 0);
			if (last && last[last.length - 1] !== 10)
				parts.push(encoder.encode(ending));
			for (const part of appended) parts.push(part);
		}
		return { ok: true, candidate: joinBytes(parts) };
	}
}
