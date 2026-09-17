import type { UserWebhookEvent } from "@clerk/backend";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { env, httpAction } from "./_generated/server";
import { syncClerkUser } from "./clerk";
import { httpStatus } from "./http_status";

/**
 * Every event Clerk sends about an account, and whether it changes what we hold. Clerk's own type
 * names them, so an event Clerk adds later fails to compile here until somebody decides about it.
 */
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
				// Clerk says the account is gone and its own read still returns it. Accepting the event
				// would be the last time Clerk mentions it, so it is asked for again instead.
				return new Response(null, { status: httpStatus.serviceUnavailable });
			}
		} catch {
			// Clerk sends a webhook again when it is not accepted, and no detail of the failure
			// goes back to it.
			return new Response(null, { status: httpStatus.serviceUnavailable });
		}
	}

	return new Response(null, { status: httpStatus.noContent });
});
