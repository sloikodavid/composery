import type { UserWebhookEvent } from "@clerk/backend";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { env, httpAction } from "./_generated/server";
import { syncClerkUser } from "./clerk";
import { httpStatus } from "./http_status";

/** Exhaustive so a new Clerk event requires an explicit decision. */
const accountEvents: Record<UserWebhookEvent["type"], true> = {
	"user.created": true,
	"user.updated": true,
	"user.deleted": true,
};

function isAccountEvent(type: string): type is UserWebhookEvent["type"] {
	return Object.hasOwn(accountEvents, type);
}

export const receiveClerkWebhook = httpAction(async (ctx, request) => {
	let event: Awaited<ReturnType<typeof verifyWebhook>>;
	try {
		event = await verifyWebhook(request, {
			signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET,
		});
	} catch {
		return new Response("Invalid webhook signature.", {
			status: httpStatus.badRequest,
		});
	}

	if (isAccountEvent(event.type)) {
		const clerkUserId = event.data.id;
		if (clerkUserId === undefined) {
			return new Response("The event has no user ID.", {
				status: httpStatus.badRequest,
			});
		}
		try {
			const outcome = await syncClerkUser(ctx, clerkUserId);
			if (event.type === "user.deleted" && outcome === "stored") {
				// Do not accept deletion until Clerk confirms the account is gone.
				return new Response(null, { status: httpStatus.serviceUnavailable });
			}
		} catch {
			// A non-2xx response makes Clerk retry without exposing internal details.
			return new Response(null, { status: httpStatus.serviceUnavailable });
		}
	}

	return new Response(null, { status: httpStatus.noContent });
});
