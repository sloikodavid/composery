import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { METRICS_POLL_INTERVAL_MINUTES } from "./boxes/boxMetrics";

const crons = cronJobs();

crons.interval(
	"release expired checkout intents",
	{ minutes: 15 },
	internal.checkout.checkoutIntents.releaseExpiredCheckoutIntents
);

crons.hourly(
	"subscription deletion reconciliation",
	{ minuteUTC: 11 },
	internal.billing.reconciliation.deleteBoxesWithoutActiveSubscriptions
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
	"reconcile hetzner resources",
	{ hourUTC: 5, minuteUTC: 17 },
	internal.boxes.reconcile.reconcileHetznerResources
);

export default crons;
