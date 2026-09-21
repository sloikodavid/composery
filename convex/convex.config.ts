import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workpool from "@convex-dev/workpool/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
	// biome-ignore-start lint/style/useNamingConvention: environment variable names
	env: {
		CLERK_FRONTEND_API_URL: v.string(),
		CLERK_SECRET_KEY: v.string(),
		CLERK_WEBHOOK_SIGNING_SECRET: v.string(),
		CLERK_FAKE_URL: v.optional(v.string()),
		HCLOUD_TOKEN: v.optional(v.string()),
		HCLOUD_LOCATIONS: v.optional(v.string()),
		HCLOUD_CONTROLLER_ID: v.optional(v.string()),
		HCLOUD_IMAGE: v.optional(v.string()),
		HCLOUD_SERVER_TYPE: v.optional(v.string()),
		HCLOUD_FAKE_URL: v.optional(v.string()),
		SSH_ACCESS_ENCRYPTION_KEYS: v.optional(v.string()),
	},
	// biome-ignore-end lint/style/useNamingConvention: environment variable names
});

app.use(rateLimiter);
app.use(workpool, { name: "hetznerCloudWork" });
app.use(workpool, { name: "hetznerCloudCleanup" });

export default app;
