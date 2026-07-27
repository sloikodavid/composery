import { fetchAction } from "convex/nextjs";
import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return response({ error: "Invalid request." }, 400);
	}
	if (!isExchangeRequest(body)) {
		return response({ error: "Invalid request." }, 400);
	}

	try {
		const result = await fetchAction(api.boxes.auth.exchangeAuthorizationCode, {
			boxId: body.boxId as Id<"boxes">,
			code: body.code,
			codeVerifier: body.codeVerifier,
			redirectUri: body.redirectUri,
			type: body.type ?? "password"
		});
		return response(result, 200);
	} catch {
		return response({ error: "Invalid or expired authorization code." }, 401);
	}
}

function isExchangeRequest(value: unknown): value is {
	boxId: string;
	code: string;
	codeVerifier: string;
	redirectUri: string;
	type?: "password" | "session";
} {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const body = value as Record<string, unknown>;
	return (
		typeof body.boxId === "string" &&
		body.boxId.length <= 64 &&
		typeof body.code === "string" &&
		body.code.length === 43 &&
		typeof body.codeVerifier === "string" &&
		body.codeVerifier.length === 43 &&
		typeof body.redirectUri === "string" &&
		body.redirectUri.length <= 512 &&
		(body.type === undefined ||
			body.type === "password" ||
			body.type === "session")
	);
}

function response(body: unknown, status: number) {
	return NextResponse.json(body, {
		status,
		headers: {
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer"
		}
	});
}
