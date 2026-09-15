import { verifyWebhook } from "@clerk/backend/webhooks";
import { env, httpAction } from "./_generated/server";
import { syncClerkUser } from "./clerk";
import { httpStatus } from "./http_status";

const userEvents = new Set(["user.created", "user.updated", "user.deleted"]);

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

	if (userEvents.has(event.type)) {
		const clerkUserId = event.data.id;
		if (clerkUserId === undefined) {
			return new Response("The event has no user ID.", {
				status: httpStatus.badRequest,
			});
		}
		await syncClerkUser(ctx, clerkUserId);
	}

	return new Response(null, { status: httpStatus.noContent });
});
