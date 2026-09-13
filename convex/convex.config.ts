import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
	env: {
		CLERK_FRONTEND_API_URL: v.string(),
		CLERK_SECRET_KEY: v.string(),
		CLERK_WEBHOOK_SIGNING_SECRET: v.string(),
	},
});

app.use(rateLimiter);

export default app;
