import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workpool from "@convex-dev/workpool/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
	env: {
		CLERK_FRONTEND_API_URL: v.string(),
		CLERK_SECRET_KEY: v.string(),
		CLERK_WEBHOOK_SIGNING_SECRET: v.string(),
		HCLOUD_TOKEN: v.optional(v.string()),
		HCLOUD_LOCATIONS: v.optional(v.string()),
		HCLOUD_FIREWALL_ID: v.optional(v.string()),
		HCLOUD_CONTROLLER_ID: v.optional(v.string()),
		HCLOUD_IMAGE: v.optional(v.string()),
		SSH_CREDENTIAL_KEY: v.optional(v.string()),
	},
});

app.use(rateLimiter);
app.use(workpool);
app.use(workpool, { name: "serverCleanup" });

export default app;
