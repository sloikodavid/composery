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
	// Two ways to authorise the same write: a setup grant from the website
	// (ownership proven through Clerk), or the box's current hash (the holder
	// proved the current password on the box itself).
	if (isPasswordChangeRequest(body)) {
		try {
			const result = await fetchAction(api.boxes.boxAuth.changePassword, {
				boxId: body.boxId as Id<"boxes">,
				currentRuntimeAuthHash: body.currentRuntimeAuthHash,
				runtimeAuthHash: body.runtimeAuthHash
			});
			return response(result, 202);
		} catch {
			return response({ error: "Password change could not start." }, 409);
		}
	}
	if (!isPasswordRequest(body)) {
		return response({ error: "Invalid request." }, 400);
	}

	try {
		const result = await fetchAction(api.boxes.boxAuth.installPassword, {
			boxId: body.boxId as Id<"boxes">,
			grant: body.grant,
			runtimeAuthHash: body.runtimeAuthHash
		});
		return response(result, 202);
	} catch {
		return response({ error: "Password setup could not start." }, 409);
	}
}

function isPasswordChangeRequest(value: unknown): value is {
	boxId: string;
	currentRuntimeAuthHash: string;
	runtimeAuthHash: string;
} {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const body = value as Record<string, unknown>;
	return (
		typeof body.boxId === "string" &&
		body.boxId.length <= 64 &&
		typeof body.currentRuntimeAuthHash === "string" &&
		body.currentRuntimeAuthHash.length <= 512 &&
		body.currentRuntimeAuthHash.startsWith("$argon2id$") &&
		typeof body.runtimeAuthHash === "string" &&
		body.runtimeAuthHash.length <= 512 &&
		body.runtimeAuthHash.startsWith("$argon2id$")
	);
}

function isPasswordRequest(value: unknown): value is {
	boxId: string;
	grant: string;
	runtimeAuthHash: string;
} {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const body = value as Record<string, unknown>;
	return (
		typeof body.boxId === "string" &&
		body.boxId.length <= 64 &&
		typeof body.grant === "string" &&
		body.grant.length === 43 &&
		typeof body.runtimeAuthHash === "string" &&
		body.runtimeAuthHash.length <= 512 &&
		body.runtimeAuthHash.startsWith("$argon2id$")
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
