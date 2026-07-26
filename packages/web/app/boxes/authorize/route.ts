import { auth } from "@clerk/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { signInUrlForReturnPath } from "@/lib/auth-routing";

export const dynamic = "force-dynamic";

const BOX_ID_PATTERN = /^[a-z0-9]+$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STATE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

function error(message: string, status = 400) {
	return new NextResponse(message, {
		status,
		headers: {
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer"
		}
	});
}

export async function GET(request: Request) {
	const url = new URL(request.url);
	const boxId = url.searchParams.get("box_id") ?? "";
	const codeChallenge = url.searchParams.get("code_challenge") ?? "";
	const state = url.searchParams.get("state") ?? "";
	const redirectUri = url.searchParams.get("redirect_uri") ?? "";
	if (
		!BOX_ID_PATTERN.test(boxId) ||
		!CHALLENGE_PATTERN.test(codeChallenge) ||
		!STATE_PATTERN.test(state) ||
		redirectUri.length > 512
	) {
		return error("Invalid box authorization request.");
	}

	const session = await auth();
	if (!session.isAuthenticated) {
		const returnPath = `${url.pathname}${url.search}`;
		return NextResponse.redirect(
			new URL(signInUrlForReturnPath(returnPath), url.origin),
			{ headers: { "Cache-Control": "no-store" } }
		);
	}

	const token = await session.getToken({ template: "convex" });
	if (!token) return error("Authentication unavailable.", 503);

	try {
		const authorization = await fetchAction(
			api.boxes.boxAuth.createAuthorizationCode,
			{
				boxId: boxId as Id<"boxes">,
				codeChallenge,
				redirectUri
			},
			{ token }
		);
		const callback = new URL(authorization.redirectUri);
		callback.searchParams.set("code", authorization.code);
		callback.searchParams.set("state", state);
		return NextResponse.redirect(callback, {
			headers: {
				"Cache-Control": "no-store",
				"Referrer-Policy": "no-referrer"
			}
		});
	} catch {
		return error("Box authorization is unavailable.", 404);
	}
}
