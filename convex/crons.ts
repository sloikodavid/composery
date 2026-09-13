import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval(
	"scan provider inventory",
	{ seconds: 30 },
	internal.server_inventory.schedule,
	{},
);
crons.interval(
	"reconcile servers",
	{ seconds: 10 },
	internal.server_lifecycle.sweep,
	{},
);

crons.interval(
	"reconcile users with Clerk",
	{ hours: 1 },
	internal.users.reconcile,
	{},
);

export default crons;
