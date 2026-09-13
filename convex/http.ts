import { verifyWebhook } from "@clerk/backend/webhooks";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { env, httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
	path: "/webhooks/clerk",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		let event: Awaited<ReturnType<typeof verifyWebhook>>;
		try {
			event = await verifyWebhook(request, {
				signingSecret: env.CLERK_WEBHOOK_SIGNING_SECRET,
			});
		} catch {
			return new Response("Invalid webhook signature.", { status: 400 });
		}

		if (
			event.type === "user.created" ||
			event.type === "user.updated" ||
			event.type === "user.deleted"
		) {
			const clerkUserId = event.data.id;
			if (clerkUserId === undefined) {
				return new Response("The event has no user ID.", { status: 400 });
			}
			await ctx.runAction(internal.users.syncFromClerk, { clerkUserId });
		}

		return new Response(null, { status: 204 });
	}),
});

export default http;
