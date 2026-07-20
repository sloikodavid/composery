import * as crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { renderAuthPage } from "./authPage";

const AUTHORIZATION_COOKIE = "composery-cloud-authorization";
const SETUP_COOKIE = "composery-cloud-setup";
// Long enough to survive a Clerk sign-in (or sign-up) on the cloud side;
// PKCE keeps a lingering transaction cookie harmless.
const AUTHORIZATION_MAX_AGE_MS = 10 * 60_000;
const SETUP_MAX_AGE_MS = 10 * 60_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

type CloudConfig = {
	boxId: string;
	origin: string;
};

function readCloudConfig(): CloudConfig | undefined {
	const boxId = process.env.COMPOSERY_CLOUD_BOX_ID?.trim();
	const rawOrigin = process.env.COMPOSERY_CLOUD_ORIGIN?.trim();
	if (!boxId && !rawOrigin) return undefined;
	if (!boxId || !rawOrigin) {
		throw new Error(
			"COMPOSERY_CLOUD_BOX_ID and COMPOSERY_CLOUD_ORIGIN must be configured together"
		);
	}
	const origin = new URL(rawOrigin);
	if (
		origin.protocol !== "https:" ||
		origin.pathname !== "/" ||
		origin.search ||
		origin.hash
	) {
		throw new Error("COMPOSERY_CLOUD_ORIGIN must be an HTTPS origin");
	}
	return { boxId, origin: origin.origin };
}

export const cloudConfig = readCloudConfig();
export const router = Router();

function randomToken() {
	return crypto.randomBytes(32).toString("base64url");
}

function challenge(verifier: string) {
	return crypto.createHash("sha256").update(verifier).digest("base64url");
}

type AuthorizationTransaction = { state: string; verifier: string };

function authorizationTransactions(req: Request): AuthorizationTransaction[] {
	const encoded = req.cookies?.[AUTHORIZATION_COOKIE];
	if (typeof encoded !== "string" || encoded.length > 2048) return [];
	try {
		const parsed = JSON.parse(
			Buffer.from(encoded, "base64url").toString("utf8")
		) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter(
			(value): value is AuthorizationTransaction =>
				value !== null &&
				typeof value === "object" &&
				TOKEN_PATTERN.test((value as AuthorizationTransaction).state) &&
				TOKEN_PATTERN.test((value as AuthorizationTransaction).verifier)
		);
	} catch {
		return [];
	}
}

function setAuthorizationTransactions(
	res: Response,
	transactions: AuthorizationTransaction[]
) {
	if (transactions.length === 0) {
		res.clearCookie(AUTHORIZATION_COOKIE, restrictedCookie);
		return;
	}
	res.cookie(
		AUTHORIZATION_COOKIE,
		Buffer.from(JSON.stringify(transactions)).toString("base64url"),
		{
			...restrictedCookie,
			maxAge: AUTHORIZATION_MAX_AGE_MS
		}
	);
}

function callbackUrl(req: Request) {
	const host = req.headers.host;
	if (!host) throw new Error("Missing request host");
	return `https://${host}/_composery/cloud/callback`;
}

const restrictedCookie = {
	httpOnly: true,
	secure: true,
	sameSite: "lax" as const,
	path: "/"
};

export function hasCloudSetupGrant(req: Request) {
	const value = req.cookies?.[SETUP_COOKIE];
	return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export function clearCloudSetupGrant(res: Response) {
	res.clearCookie(SETUP_COOKIE, restrictedCookie);
}

router.get("/authorize", (req, res) => {
	if (!cloudConfig) {
		res.status(404).send("Not found");
		return;
	}
	const verifier = randomToken();
	const state = randomToken();
	setAuthorizationTransactions(
		res,
		[...authorizationTransactions(req), { state, verifier }].slice(-4)
	);
	const authorization = new URL("/boxes/authorize", cloudConfig.origin);
	authorization.searchParams.set("box_id", cloudConfig.boxId);
	authorization.searchParams.set("code_challenge", challenge(verifier));
	authorization.searchParams.set("state", state);
	res.setHeader("Cache-Control", "no-store");
	res.setHeader("Referrer-Policy", "no-referrer");
	res.redirect(authorization.toString());
});

router.get("/callback", async (req, res) => {
	if (!cloudConfig) {
		res.status(404).send("Not found");
		return;
	}
	const code = typeof req.query.code === "string" ? req.query.code : "";
	const state = typeof req.query.state === "string" ? req.query.state : "";
	const transactions = authorizationTransactions(req);
	const transaction = transactions.find((candidate) => candidate.state === state);
	const verifier = transaction?.verifier;
	setAuthorizationTransactions(
		res,
		transactions.filter((candidate) => candidate.state !== state)
	);
	if (
		!TOKEN_PATTERN.test(code) ||
		!TOKEN_PATTERN.test(state) ||
		!TOKEN_PATTERN.test(verifier ?? "")
	) {
		res.redirect("/_composery/cloud/error");
		return;
	}

	try {
		const response = await fetch(
			new URL("/api/cloud/auth/exchange", cloudConfig.origin),
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					boxId: cloudConfig.boxId,
					code,
					codeVerifier: verifier,
					redirectUri: callbackUrl(req)
				}),
				signal: AbortSignal.timeout(15_000)
			}
		);
		const body = (await response.json()) as { grant?: unknown };
		if (!response.ok || typeof body.grant !== "string") throw new Error();
		res.cookie(SETUP_COOKIE, body.grant, {
			...restrictedCookie,
			maxAge: SETUP_MAX_AGE_MS
		});
		res.setHeader("Cache-Control", "no-store");
		res.redirect("/register");
	} catch {
		res.redirect("/_composery/cloud/error");
	}
});

router.get("/error", async (req, res) => {
	res.setHeader("Cache-Control", "no-store");
	res.setHeader("Referrer-Policy", "no-referrer");
	res.status(503).send(
		await renderAuthPage(req, {
			page: "cloud-error",
			title: "Cloud authorization unavailable",
			formLabel: "Cloud authorization",
			error: "Cloud authorization could not finish."
		})
	);
});

// Records a password the box already changed for itself, authorised by the
// hash it is replacing. Keeps the website in step so the next bootstrap does
// not restore the old password; no setup grant, so no website account needed.
export async function changeCloudPassword(
	currentRuntimeAuthHash: string,
	runtimeAuthHash: string
) {
	if (!cloudConfig) throw new Error("Cloud authentication is not configured");
	const response = await fetch(
		new URL("/api/cloud/auth/password", cloudConfig.origin),
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				boxId: cloudConfig.boxId,
				currentRuntimeAuthHash,
				runtimeAuthHash
			}),
			signal: AbortSignal.timeout(30_000)
		}
	);
	if (!response.ok) throw new Error("Cloud password change failed");
}

export async function installCloudPassword(
	req: Request,
	runtimeAuthHash: string
) {
	if (!cloudConfig) throw new Error("Cloud authentication is not configured");
	const grant = req.cookies?.[SETUP_COOKIE];
	if (typeof grant !== "string" || !TOKEN_PATTERN.test(grant)) {
		throw new Error("Missing cloud setup grant");
	}
	const response = await fetch(
		new URL("/api/cloud/auth/password", cloudConfig.origin),
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				boxId: cloudConfig.boxId,
				grant,
				runtimeAuthHash
			}),
			signal: AbortSignal.timeout(30_000)
		}
	);
	if (!response.ok) throw new Error("Cloud password setup failed");
}
