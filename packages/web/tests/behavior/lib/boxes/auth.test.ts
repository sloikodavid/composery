import { describe, expect, test } from "vitest";

import {
	ARGON2ID_HASH,
	BASE64URL_SHA256,
	CLOUD_AUTH_HEADERS,
	isAuthorizationType,
	isBoxIdString,
	isFlowSecret,
	isOauthState,
	isPasswordHash,
	isRedirectUri,
	MAX_HASH_LENGTH,
	MAX_REDIRECT_URI_LENGTH
} from "@/lib/boxes/auth";

// The shapes both ends of the box authorization flow check: the Next routes that
// turn a malformed request into a 400, and the Convex actions that decide. They
// used to be four spellings of the same regex, so what matters here is that each
// one still refuses what it was written to refuse.

const SECRET = "a".repeat(43);
const HASH = "$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA";

describe("flow secrets", () => {
	test("accepts exactly 43 characters of unpadded base64url", () => {
		expect(isFlowSecret(SECRET)).toBe(true);
		expect(isFlowSecret("Ab-_0123456789012345678901234567890123456789")).toBe(
			false
		);
		expect(isFlowSecret("Ab-_012345678901234567890123456789012345678")).toBe(
			true
		);
	});

	// Length is the whole guard: a shorter code is a truncated one and a longer
	// one is not from this flow. Both directions, because a `{43,}` typo would
	// pass every value the strict form rejects for being too long.
	test("refuses anything shorter or longer", () => {
		expect(isFlowSecret("a".repeat(42))).toBe(false);
		expect(isFlowSecret("a".repeat(44))).toBe(false);
	});

	test("refuses padding, standard-alphabet base64 and non-strings", () => {
		expect(isFlowSecret(`${"a".repeat(42)}=`)).toBe(false);
		expect(isFlowSecret(`${"a".repeat(42)}+`)).toBe(false);
		expect(isFlowSecret(`${"a".repeat(42)}/`)).toBe(false);
		expect(isFlowSecret(undefined)).toBe(false);
		expect(isFlowSecret(43)).toBe(false);
	});

	test("is anchored, so a valid secret inside a longer string does not pass", () => {
		expect(BASE64URL_SHA256.test(`x${SECRET}`)).toBe(false);
		expect(BASE64URL_SHA256.test(`${SECRET}\nx`)).toBe(false);
	});
});

describe("password hashes", () => {
	test("accepts an argon2id encoded hash", () => {
		expect(isPasswordHash(HASH)).toBe(true);
	});

	// The website is never sent a password, only a hash the box computed. A value
	// that is not one is the case worth refusing loudly - it would mean a caller
	// had sent the thing itself.
	test("refuses another algorithm, or a bare password", () => {
		expect(isPasswordHash("$argon2i$v=19$m=65536$c2FsdA$aGFzaA")).toBe(false);
		expect(isPasswordHash("$2b$12$abcdefghijklmnopqrstuv")).toBe(false);
		expect(isPasswordHash("correct horse battery staple")).toBe(false);
		expect(isPasswordHash(null)).toBe(false);
	});

	test("refuses a hash past the length bound", () => {
		const long = `$argon2id$${"a".repeat(MAX_HASH_LENGTH)}`;
		expect(long.length).toBeGreaterThan(MAX_HASH_LENGTH);
		expect(isPasswordHash(long)).toBe(false);
		expect(ARGON2ID_HASH.test(long)).toBe(true);
	});
});

describe("box ids and redirects", () => {
	test("holds a box id to the shape Convex gives it", () => {
		expect(isBoxIdString("j57abc")).toBe(true);
		expect(isBoxIdString("a".repeat(64))).toBe(true);
		expect(isBoxIdString("a".repeat(65))).toBe(false);
		expect(isBoxIdString(undefined)).toBe(false);
		expect(isBoxIdString("")).toBe(false);
	});

	// The authorize route always required this; the exchange and password routes
	// took any string of the right length, so the same argument had two shapes
	// depending on which door it arrived at.
	test("refuses a box id that is merely short enough", () => {
		expect(isBoxIdString("J57ABC")).toBe(false);
		expect(isBoxIdString("j57-abc")).toBe(false);
		expect(isBoxIdString("../../etc")).toBe(false);
	});

	test("bounds a redirect without pretending to validate it", () => {
		expect(isRedirectUri("https://box.example/callback")).toBe(true);
		expect(isRedirectUri("x".repeat(MAX_REDIRECT_URI_LENGTH))).toBe(true);
		expect(isRedirectUri("x".repeat(MAX_REDIRECT_URI_LENGTH + 1))).toBe(false);
		expect(isRedirectUri(undefined)).toBe(false);
	});

	test("states one redirect bound for both ends of the flow", () => {
		expect(MAX_REDIRECT_URI_LENGTH).toBe(512);
	});
});

// The box's own value, handed back untouched, so it is bounded rather than
// pinned to a length the way the secrets we mint are.
describe("the state a box hands us", () => {
	test("accepts base64url between 43 and 128 characters", () => {
		expect(isOauthState("a".repeat(43))).toBe(true);
		expect(isOauthState("a".repeat(128))).toBe(true);
		expect(isOauthState("a".repeat(42))).toBe(false);
		expect(isOauthState("a".repeat(129))).toBe(false);
		expect(isOauthState(`${"a".repeat(42)}!`)).toBe(false);
	});
});

// Fail towards refusing: an unrecognised type must not fall through to
// "password", which is the one that installs a credential.
describe("authorization types", () => {
	test("accepts the two the flow has and nothing else", () => {
		expect(isAuthorizationType("password")).toBe(true);
		expect(isAuthorizationType("session")).toBe(true);
		expect(isAuthorizationType("Password")).toBe(false);
		expect(isAuthorizationType("constructor")).toBe(false);
		expect(isAuthorizationType(undefined)).toBe(false);
	});
});

// The URLs carry one-time codes and the responses carry the grant they exchange
// for, so neither may be cached or leak its query string onward.
describe("cloud auth response headers", () => {
	test("forbids caching and referrer leakage", () => {
		expect(CLOUD_AUTH_HEADERS).toEqual({
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer"
		});
	});
});
