import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
	"sweep Hetzner Cloud inventory",
	{ seconds: 30 },
	internal.allocations.hetzner_cloud.inventory.sweep,
	{},
);

crons.interval(
	"sweep Hetzner Cloud allocations",
	{ seconds: 10 },
	internal.allocations.hetzner_cloud.worker_state.sweep,
	{},
);

crons.interval(
	"reconcile users with Clerk",
	{ hours: 1 },
	internal.clerk.reconcile,
	{},
);

export default crons;
