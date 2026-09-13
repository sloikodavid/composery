import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
	"reconcile users with Clerk",
	{ hours: 1 },
	internal.users.reconcile,
	{},
);

export default crons;
