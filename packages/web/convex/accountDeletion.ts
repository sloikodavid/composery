import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
	internalAction,
	internalMutation,
	internalQuery,
	type ActionCtx
} from "./_generated/server";
import { startBoxOperation } from "./boxes/boxOperations";
import { requiredEnv } from "./env";
import {
	accountDeletionBoxTargets,
	accountDeletionReady,
	deletionIdempotencyKey,
	scrubbedAccountEmail
} from "./accountDeletionLogic";

const ACCOUNT_DELETION_FINALIZER_DELAY_MS = 15 * 60 * 1000;
const ACCOUNT_DELETION_PAGE_SIZE = 100;
const POLAR_API_HOSTS = {
	production: "https://api.polar.sh",
	sandbox: "https://sandbox-api.polar.sh"
} as const;

type DeletionTrigger = "clerk_webhook" | "staff";
type AccountDeletionResult = { status: "missing" | "pending" };
type DeletionState = {
	boxes: Doc<"boxes">[];
	user: Doc<"users"> | null;
};

function polarApiBaseUrl() {
	const environment = process.env.POLAR_ENVIRONMENT ?? "sandbox";
	if (environment !== "sandbox" && environment !== "production") {
		throw new Error("POLAR_ENVIRONMENT must be sandbox or production.");
	}
	return POLAR_API_HOSTS[environment];
}

async function revokePolarSubscription(subscriptionId: string) {
	const response = await fetch(
		`${polarApiBaseUrl()}/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,
		{
			method: "DELETE",
			headers: {
				Authorization: `Bearer ${requiredEnv("POLAR_ORGANIZATION_TOKEN")}`
			}
		}
	);

	if (response.ok || response.status === 404) return;

	// The finalizer re-runs this for every not-yet-deleted box, so a
	// subscription revoked on an earlier pass answers
	// AlreadyCanceledSubscription. That is success - throwing here would block
	// the box-delete retry behind it forever.
	const body = await response.text().catch(() => "");
	if (body.includes("AlreadyCanceledSubscription")) return;

	throw new Error(
		`Polar subscription revoke failed for ${subscriptionId}: ${response.status} ${body}`
	);
}

async function stateForClerkUser(
	ctx: Pick<ActionCtx, "runQuery">,
	clerkUserId: string
): Promise<DeletionState> {
	return await ctx.runQuery(internal.accountDeletion.accountDeletionState, {
		clerkUserId
	});
}

async function startDeletionWorkflows(ctx: ActionCtx, boxes: Doc<"boxes">[]) {
	for (const box of accountDeletionBoxTargets(boxes)) {
		await revokePolarSubscription(box.polar_subscription_id);

		try {
			await startBoxOperation(ctx, box._id, "delete", {
				idempotencyKey: deletionIdempotencyKey(box.polar_subscription_id)
			});
		} catch {
			// The finalizer retries busy boxes until the normal operation gate opens.
		}
	}
}

async function scheduleFinalizer(
	ctx: Pick<ActionCtx, "runMutation">,
	clerkUserId: string,
	delayMs = ACCOUNT_DELETION_FINALIZER_DELAY_MS
) {
	await ctx.runMutation(internal.accountDeletion.scheduleAccountDeletionFinalizer, {
		clerkUserId,
		delayMs
	});
}

async function runAccountDeletion(
	ctx: ActionCtx,
	input: {
		clerkUserId: string;
		trigger: DeletionTrigger;
	}
): Promise<AccountDeletionResult> {
	const marked = await ctx.runMutation(
		internal.accountDeletion.markAccountDeletionPending,
		input
	);
	if (!marked) return { status: "missing" as const };

	const state = await stateForClerkUser(ctx, input.clerkUserId);
	await startDeletionWorkflows(ctx, state.boxes);

	await scheduleFinalizer(ctx, input.clerkUserId, 0);
	return { status: "pending" as const };
}

export const accountDeletionState = internalQuery({
	args: {
		clerkUserId: v.string()
	},
	handler: async (ctx, args): Promise<DeletionState> => {
		const user = await ctx.db
			.query("users")
			.withIndex("clerk_user_id", (query) =>
				query.eq("clerk_user_id", args.clerkUserId)
			)
			.first();

		const boxes = await ctx.db
			.query("boxes")
			.withIndex("user_id", (query) => query.eq("user_id", args.clerkUserId))
			.collect();

		return { boxes, user };
	}
});

export const pendingAccountDeletionsPage = internalQuery({
	args: {
		cursor: v.union(v.string(), v.null())
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query("users")
			.withIndex("deletion_pending", (query) =>
				query.eq("deletion_pending", true)
			)
			.paginate({
				cursor: args.cursor,
				numItems: ACCOUNT_DELETION_PAGE_SIZE
			});
	}
});

export const markAccountDeletionPending = internalMutation({
	args: {
		clerkUserId: v.string(),
		trigger: v.union(v.literal("clerk_webhook"), v.literal("staff"))
	},
	handler: async (ctx, args) => {
		const user = await ctx.db
			.query("users")
			.withIndex("clerk_user_id", (query) =>
				query.eq("clerk_user_id", args.clerkUserId)
			)
			.first();

		if (!user) return null;
		if (user.deletion_finished_at) return user._id;

		const timestamp = Date.now();
		if (!user.deletion_pending) {
			await ctx.db.patch(user._id, {
				deletion_pending: true,
				deletion_requested_at: timestamp,
				deletion_requested_by: args.trigger,
				updated_at: timestamp
			});
		}

		// Release any open checkout reservation right away: a payment completing
		// after this point must not convert into a box owned by a deleted
		// account, and the slug should free up immediately.
		const intents = await ctx.db
			.query("box_checkout_intents")
			.withIndex("user_id", (query) =>
				query.eq("user_id", args.clerkUserId)
			)
			.collect();
		for (const intent of intents) {
			if (intent.status !== "active" || intent.box_id) continue;
			await ctx.db.patch(intent._id, {
				status: "released",
				released_at: timestamp,
				release_reason: "account_deleted",
				updated_at: timestamp
			});
		}

		return user._id;
	}
});

export const scheduleAccountDeletionFinalizer = internalMutation({
	args: {
		clerkUserId: v.string(),
		delayMs: v.number()
	},
	handler: async (ctx, args) => {
		await ctx.scheduler.runAfter(
			args.delayMs,
			internal.accountDeletion.finalizeAccountDeletion,
			{ clerkUserId: args.clerkUserId }
		);
	}
});

export const finishAccountDeletion = internalMutation({
	args: {
		clerkUserId: v.string()
	},
	handler: async (ctx, args) => {
		const user = await ctx.db
			.query("users")
			.withIndex("clerk_user_id", (query) =>
				query.eq("clerk_user_id", args.clerkUserId)
			)
			.first();
		if (!user || !user.deletion_pending || user.deletion_finished_at) return;

		const timestamp = Date.now();
		const intents = await ctx.db
			.query("box_checkout_intents")
			.withIndex("user_id", (query) => query.eq("user_id", args.clerkUserId))
			.collect();

		for (const intent of intents) {
			await ctx.db.patch(intent._id, {
				user_id: `deleted:${user._id}`,
				slug: `deleted-${intent._id}`,
				polar_checkout_url: undefined,
				runtime_auth_hash: "",
				updated_at: timestamp
			});
		}

		await ctx.db.patch(user._id, {
			email: scrubbedAccountEmail(user._id),
			deletion_pending: false,
			deletion_finished_at: timestamp,
			updated_at: timestamp
		});
	}
});

export const requestAccountDeletionForClerkUser = internalAction({
	args: {
		clerkUserId: v.string(),
		trigger: v.union(v.literal("clerk_webhook"), v.literal("staff"))
	},
	handler: async (ctx, args): Promise<AccountDeletionResult> => {
		return await runAccountDeletion(ctx, args);
	}
});

export const finalizeAccountDeletion = internalAction({
	args: {
		clerkUserId: v.string()
	},
	handler: async (ctx, args) => {
		const state = await stateForClerkUser(ctx, args.clerkUserId);
		if (!state.user?.deletion_pending || state.user.deletion_finished_at) return;

		await startDeletionWorkflows(ctx, state.boxes);

		const refreshed = await stateForClerkUser(ctx, args.clerkUserId);
		if (accountDeletionReady(refreshed.boxes)) {
			await ctx.runMutation(internal.accountDeletion.finishAccountDeletion, {
				clerkUserId: args.clerkUserId
			});
			return;
		}

		await scheduleFinalizer(ctx, args.clerkUserId);
	}
});

export const sweepPendingAccountDeletions = internalAction({
	args: {},
	handler: async (ctx) => {
		let cursor: string | null = null;

		for (;;) {
			const page: {
				continueCursor: string;
				isDone: boolean;
				page: Doc<"users">[];
			} = await ctx.runQuery(
				internal.accountDeletion.pendingAccountDeletionsPage,
				{ cursor }
			);

			for (const user of page.page) {
				await scheduleFinalizer(ctx, user.clerk_user_id, 0);
			}

			if (page.isDone) break;
			cursor = page.continueCursor;
		}
	}
});
