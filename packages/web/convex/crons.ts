import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { METRICS_POLL_INTERVAL_MINUTES } from "./boxes/boxMetrics";

const crons = cronJobs();

crons.interval(
	"release expired checkout intents",
	{ minutes: 15 },
	internal.checkout.checkoutIntents.releaseExpiredCheckoutIntents
);

crons.interval(
	"delete expired box authorization records",
	{ minutes: 15 },
	internal.boxes.boxAuth.deleteExpiredAuthRecords
);

crons.interval(
	"reconcile capacity alerts",
	{ minutes: 15 },
	internal.boxes.capacityAlerts.reconcile
);

crons.interval(
	"retry staff alerts",
	{ minutes: 15 },
	internal.staffAlerts.retryPending
);

crons.hourly(
	"subscription deletion reconciliation",
	{ minuteUTC: 11 },
	internal.billing.reconciliation.deleteBoxesWithoutActiveSubscriptions
);

crons.hourly(
	"account deletion finalization",
	{ minuteUTC: 19 },
	internal.accountDeletion.sweepPendingAccountDeletions
);

crons.interval(
	"poll box metrics",
	{ minutes: METRICS_POLL_INTERVAL_MINUTES },
	internal.boxes.boxMetricsPoll.pollBoxMetrics
);

crons.hourly(
	"roll up hourly box metrics",
	{ minuteUTC: 4 },
	internal.boxes.boxMetrics.rollupHourlyMetrics,
	{}
);

crons.daily(
	"delete old box metrics",
	{ hourUTC: 4, minuteUTC: 23 },
	internal.boxes.boxMetrics.deleteOldSamples
);

crons.daily(
	"normalize deleted boxes",
	{ hourUTC: 4, minuteUTC: 29 },
	internal.boxes.boxCleanup.normalizeDeletedBoxes,
	{}
);

crons.daily(
	"purge expired deleted boxes",
	{ hourUTC: 4, minuteUTC: 31 },
	internal.boxes.boxCleanup.scheduleExpiredBoxPurges,
	{}
);

crons.daily(
	"purge expired checkout records",
	{ hourUTC: 4, minuteUTC: 37 },
	internal.boxes.boxCleanup.purgeExpiredCheckoutRecords,
	{}
);

crons.daily(
	"purge expired deleted accounts",
	{ hourUTC: 4, minuteUTC: 39 },
	internal.accountDeletion.purgeExpiredDeletedAccounts,
	{}
);

crons.daily(
	"purge expired staff alerts",
	{ hourUTC: 4, minuteUTC: 43 },
	internal.staffAlerts.purgeExpired,
	{}
);

// Aligned with metrics polling: both sweep every running box, and the
// consecutive-failure count automatic repair gates on is expressed in these
// ticks (see boxes/autoRepair.ts).
crons.interval(
	"sweep box health",
	{ minutes: 10 },
	internal.boxes.autoRepair.sweepBoxHealth,
	{}
);

// Hourly rather than per box or per page view: one registry round trip answers
// "what does the channel resolve to now" for the entire fleet.
crons.hourly(
	"refresh runtime release",
	{ minuteUTC: 26 },
	internal.boxes.runtimeRelease.refreshRuntimeRelease,
	{}
);

// Reads the refreshed release, so it runs after it within the same hour.
crons.hourly(
	"update boxes past their floor deadline",
	{ minuteUTC: 41 },
	internal.boxes.runtimeFloor.updateBoxesPastDeadline,
	{}
);

crons.daily(
	"snapshot running boxes",
	{ hourUTC: 3, minuteUTC: 7 },
	internal.boxes.boxSnapshots.scheduleAutomaticSnapshots,
	{}
);

crons.daily(
	"delete expired snapshots",
	{ hourUTC: 4, minuteUTC: 41 },
	internal.boxes.boxSnapshots.deleteExpiredSnapshots
);

// Runs after the snapshot/expiry crons so it reconciles the settled state.
crons.daily(
	"reconcile Hetzner resources",
	{ hourUTC: 5, minuteUTC: 17 },
	internal.boxes.reconcile.reconcileHetznerResources
);

export default crons;
