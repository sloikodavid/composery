/**
 * Lossless file observations and candidate edits, without I/O or authorization.
 * Recognizing an entry does not mean that sshd accepts it: a new authorization
 * needs native validation before a remote write.
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
// biome-ignore lint/style/useNamingConvention: the WHATWG Encoding API names this option
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const newlineByte = 10;
const carriageReturnByte = 13;
const optionNameCharacterPattern = /[a-zA-Z0-9-]/;
const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
const lineBreakOrNulPattern = /[\0\r\n]/;
const blankLinePattern = /^[ \t]*$/;
const commentLinePattern = /^[ \t]*#/;
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

type LineBase = {
	line: number;
	start: number;
	end: number;
	ending: AuthorizedKeysLine["ending"];
};

type PlanFailure = Extract<AuthorizedKeysPlan, { ok: false }>["reason"];

type PlanDraft = {
	changes: Map<number, Uint8Array>;
	appended: Uint8Array[];
	ending: "\n" | "\r\n";
};

function isSpace(character: string | undefined) {
	return character === " " || character === "\t";
}

function skipSpaces(text: string, start: number) {
	let index = start;
	while (isSpace(text[index])) {
		index++;
	}
	return index;
}

/** Scan one field; only backslash followed by a quote escapes a quote. */
function findFieldEnd(text: string, start: number) {
	let isQuoted = false;
	let index = start;
	for (; index < text.length; index++) {
		if (text[index] === "\\" && text[index + 1] === '"') {
			index++;
		} else if (text[index] === '"') {
			isQuoted = !isQuoted;
		} else if (!isQuoted && isSpace(text[index])) {
			break;
		}
	}
	return isQuoted ? -1 : index;
}

/** Reads a quoted value that starts at `start`. */
function parseOptionValue(text: string, start: number) {
	if (text[start] !== '"') {
		return null;
	}
	let index = start + 1;
	let value = "";
	while (index < text.length && text[index] !== '"') {
		if (text[index] === "\\" && text[index + 1] === '"') {
			index++;
		}
		value += text[index];
		index++;
	}
	return text[index] === '"' ? { value, end: index + 1 } : null;
}

function parseOption(text: string, start: number) {
	let index = start;
	while (
		index < text.length &&
		optionNameCharacterPattern.test(text[index] ?? "")
	) {
		index++;
	}
	if (index === start) {
		return null;
	}
	const name = text.slice(start, index);
	let value: string | null = null;
	if (text[index] === "=") {
		const parsed = parseOptionValue(text, index + 1);
		if (parsed === null) {
			return null;
		}
		value = parsed.value;
		index = parsed.end;
	}
	const option: AuthorizedKeyOption = Object.freeze({
		name,
		value,
		raw: text.slice(start, index),
	});
	return { option, end: index };
}

function parseOptions(text: string): readonly AuthorizedKeyOption[] | null {
	if (text.length === 0) {
		return Object.freeze([]);
	}
	const options: AuthorizedKeyOption[] = [];
	let index = 0;
	while (index < text.length) {
		const parsed = parseOption(text, index);
		if (parsed === null) {
			return null;
		}
		options.push(parsed.option);
		index = parsed.end;
		if (index === text.length) {
			break;
		}
		if (text[index] !== "," || index + 1 === text.length) {
			return null;
		}
		index++;
	}
	return Object.freeze(options);
}

/** Finds the key type field, after the options field when one is present. */
function parseKeyStart(text: string, start: number) {
	const firstEnd = findFieldEnd(text, start);
	if (firstEnd < 0) {
		return null;
	}
	const noOptions: readonly AuthorizedKeyOption[] = Object.freeze([]);
	if (keyTypes.has(text.slice(start, firstEnd))) {
		return { options: noOptions, keyStart: start, typeEnd: firstEnd };
	}
	const options = parseOptions(text.slice(start, firstEnd));
	if (options === null) {
		return null;
	}
	const keyStart = skipSpaces(text, firstEnd);
	const typeEnd = findFieldEnd(text, keyStart);
	return typeEnd < 0 ? null : { options, keyStart, typeEnd };
}

function parseFields(text: string): Fields | null {
	if (lineBreakOrNulPattern.test(text)) {
		return null;
	}
	const start = skipSpaces(text, 0);
	const keyStartFields = parseKeyStart(text, start);
	if (keyStartFields === null) {
		return null;
	}
	const { options, keyStart, typeEnd } = keyStartFields;
	const type = text.slice(keyStart, typeEnd);
	if (!keyTypes.has(type) || !isSpace(text[typeEnd])) {
		return null;
	}
	const blobStart = skipSpaces(text, typeEnd);
	let keyEnd = blobStart;
	while (keyEnd < text.length && !isSpace(text[keyEnd])) {
		keyEnd++;
	}
	const base64 = text.slice(blobStart, keyEnd);
	if (!base64Pattern.test(base64)) {
		return null;
	}
	return {
		start,
		keyStart,
		keyEnd,
		entry: Object.freeze({
			key: Object.freeze({ type, base64 }),
			options,
			comment: text.slice(skipSpaces(text, keyEnd)),
		}),
	};
}

function isSameBytes(left: Uint8Array, right: Uint8Array) {
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

function isValidText(text: string) {
	// TextEncoder replaces lone surrogates. Reject rather than change the input.
	return (
		!lineBreakOrNulPattern.test(text) &&
		decoder.decode(encoder.encode(text)) === text
	);
}

function renderKey(key: AuthorizedKey) {
	if (!keyTypes.has(key.type) || !base64Pattern.test(key.base64)) {
		return null;
	}
	return `${key.type} ${key.base64}`;
}

function renderOptions(options: readonly string[]) {
	for (const option of options) {
		if (!isValidText(option) || parseOptions(option)?.length !== 1) {
			return null;
		}
	}
	return options.length > 0 ? `${options.join(",")} ` : "";
}

function renderComment(comment: string | undefined, existing: string) {
	if (comment === undefined) {
		return existing;
	}
	return comment ? ` ${comment}` : "";
}

function toLineEnding(bytes: Uint8Array, newline: number) {
	if (newline < 0) {
		return "";
	}
	return bytes[newline - 1] === carriageReturnByte ? "\r\n" : "\n";
}

function decodeLine(bytes: Uint8Array) {
	try {
		return decoder.decode(bytes);
	} catch {
		return null;
	}
}

function toLine(base: LineBase, text: string | null): AuthorizedKeysLine {
	if (text === null) {
		return Object.freeze({ ...base, kind: "opaque", reason: "encoding" });
	}
	if (blankLinePattern.test(text)) {
		return Object.freeze({ ...base, kind: "blank" });
	}
	if (commentLinePattern.test(text)) {
		return Object.freeze({ ...base, kind: "comment" });
	}
	const fields = parseFields(text);
	return Object.freeze(
		fields
			? { ...base, kind: "entry", entry: fields.entry }
			: { ...base, kind: "opaque", reason: "syntax" },
	);
}

function renderAppend(
	edit: Extract<AuthorizedKeysEdit, { kind: "append" }>,
	ending: string,
) {
	const key = renderKey(edit.key);
	const options = renderOptions(edit.options);
	if (key === null || options === null || !isValidText(edit.comment)) {
		return null;
	}
	return encoder.encode(
		`${options}${key}${renderComment(edit.comment, "")}${ending}`,
	);
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
			const newline = this.#bytes.indexOf(newlineByte, start);
			const end = newline < 0 ? this.#bytes.length : newline + 1;
			const ending = toLineEnding(this.#bytes, newline);
			const text = decodeLine(this.#bytes.subarray(start, end - ending.length));
			texts.push(text);
			lines.push(toLine({ line: lines.length + 1, start, end, ending }, text));
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
		if (!isSameBytes(this.#bytes, current)) {
			return { ok: false, reason: "changed" };
		}
		const draft: PlanDraft = {
			changes: new Map(),
			appended: [],
			ending: this.lines.find((line) => line.ending)?.ending || "\n",
		};
		for (const edit of edits) {
			const failure = this.#applyEdit(draft, edit);
			if (failure !== null) {
				return { ok: false, reason: failure };
			}
		}
		return { ok: true, candidate: this.#renderCandidate(draft) };
	}

	#applyEdit(draft: PlanDraft, edit: AuthorizedKeysEdit): PlanFailure | null {
		switch (edit.kind) {
			case "append": {
				const appended = renderAppend(edit, draft.ending);
				if (appended === null) {
					return "invalid_edit";
				}
				draft.appended.push(appended);
				return null;
			}
			case "remove": {
				const targetFailure = this.#checkTarget(draft, edit.line);
				if (targetFailure === null) {
					draft.changes.set(edit.line, new Uint8Array());
				}
				return targetFailure;
			}
			case "update": {
				const targetFailure = this.#checkTarget(draft, edit.line);
				if (targetFailure !== null) {
					return targetFailure;
				}
				const updated = this.#renderUpdate(edit);
				if (typeof updated === "string") {
					return updated;
				}
				draft.changes.set(edit.line, updated);
				return null;
			}
		}
	}

	#checkTarget(draft: PlanDraft, lineNumber: number): PlanFailure | null {
		const line = this.lines[lineNumber - 1];
		if (!Number.isSafeInteger(lineNumber) || line?.kind !== "entry") {
			return "invalid_target";
		}
		return draft.changes.has(lineNumber) ? "duplicate_target" : null;
	}

	#renderUpdate(
		edit: Extract<AuthorizedKeysEdit, { kind: "update" }>,
	): Uint8Array | PlanFailure {
		const line = this.lines[edit.line - 1];
		const text = this.#text[edit.line - 1];
		const fields =
			text === null || text === undefined ? null : parseFields(text);
		if (
			fields === null ||
			text === null ||
			text === undefined ||
			line === undefined
		) {
			return "invalid_target";
		}
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
			(edit.comment !== undefined && !isValidText(edit.comment))
		) {
			return "invalid_edit";
		}
		const comment = renderComment(edit.comment, text.slice(fields.keyEnd));
		return encoder.encode(
			`${text.slice(0, fields.start)}${options}${key}${comment}${line.ending}`,
		);
	}

	#renderCandidate(draft: PlanDraft) {
		const parts = this.lines.map(
			(line) =>
				draft.changes.get(line.line) ??
				this.#bytes.subarray(line.start, line.end),
		);
		if (draft.appended.length > 0) {
			const last = parts.findLast((part) => part.length > 0);
			if (last !== undefined && last.at(-1) !== newlineByte) {
				parts.push(encoder.encode(draft.ending));
			}
			parts.push(...draft.appended);
		}
		return joinBytes(parts);
	}
}
