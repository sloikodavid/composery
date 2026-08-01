import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";

// How a box's recorded runtime image compares to the fleet's, and what that
// means for its owner. Pure, so the whole matrix is testable without a registry
// or a database - the interface, the floor cron, and the staff console all read
// their answer from here rather than each re-deriving it from digests.
export type RuntimeStanding = {
	// True only when we positively know the box is behind. Unknown - no fleet
	// release cached yet, or a box with no recorded image - is never reported as
	// an update being available, because offering an update we cannot describe is
	// worse than staying quiet until the next refresh.
	updateAvailable: boolean;
	// Whether the comparison above could be made at all - both the box's digest
	// and the fleet's were known. `updateAvailable: false` covers "on the fleet
	// image" and "nothing to compare against" alike, and only this separates
	// them, so an interface that renders the second as "up to date" is reporting
	// a success it never checked.
	comparable: boolean;
	availableVersion: string | null;
	currentVersion: string | null;
	// Set when a floor applies to this box. `deadline` is when it stops being the
	// owner's choice; null means a floor exists but nothing is scheduled yet.
	requiredBy: number | null;
	required: boolean;
};

export type FleetRelease = {
	image: string;
	version: string | null;
} | null;

export type MinimumRelease = {
	deadline: number | null;
	image: string;
	version: string | null;
} | null;

// Comparison is by digest and never by version string. A channel can publish a
// new build under an unchanged version label, and two different labels can name
// the same digest after a retag; the digest is the only thing that says what a
// box actually runs.
export function runtimeStanding({
	boxImage,
	boxVersion,
	fleet,
	minimum
}: {
	boxImage: string | null | undefined;
	boxVersion: string | null | undefined;
	fleet: FleetRelease;
	minimum: MinimumRelease;
}): RuntimeStanding {
	const currentVersion = boxVersion ?? null;
	// Both digests known is what makes the comparison mean anything: without it
	// "not behind" is only "not known to be behind".
	const comparable = Boolean(boxImage && fleet?.image);
	const behindFleet = comparable && boxImage !== fleet?.image;

	// A floor only binds a box that is not already on the floor's image. It is
	// deliberately independent of the fleet comparison: the floor can lag the
	// channel (it is raised deliberately, after the fleet has moved), and a box
	// sitting exactly on the floor is compliant even while an optional newer
	// release exists.
	const required = Boolean(
		boxImage && minimum?.image && boxImage !== minimum.image
	);

	return {
		updateAvailable: behindFleet,
		comparable,
		availableVersion: fleet?.version ?? null,
		currentVersion,
		required,
		requiredBy: required ? (minimum?.deadline ?? null) : null
	};
}

// True when a box below the floor has run out of time to update itself. The
// comparison is `>=` so a deadline exactly now has passed; a floor with no
// deadline never forces anything, which is what makes setting an image without
// a date a safe way to announce a floor before enforcing it.
export function floorDeadlinePassed(
	standing: RuntimeStanding,
	now: number
): boolean {
	return (
		standing.required &&
		standing.requiredBy !== null &&
		now >= standing.requiredBy
	);
}

// The version label of the cached fleet release, and nothing else.
//
// Public and unauthenticated because the in-IDE update notifier on every cloud
// box asks for it and a box holds no website session. That is why it returns one
// string instead of the settings object: the digest, the floor and its deadline,
// and everything else about the fleet stay behind the authenticated queries.
//
// Null means we have no cached release to compare against - never refreshed yet,
// or a channel tag that resolved to no version. Callers must read that as "not
// known", never as "you are current".
// Refresh the cached fleet release. Scheduled hourly rather than computed per
// box or per page view: it is one registry round trip for the whole fleet, and
// the answer is identical for every box.
export const refreshRuntimeRelease = internalAction({
	args: {},
	handler: async (ctx) => {
		const release = await ctx.runAction(
			internal.boxes.infra.runtimeImages.resolveConfiguredRuntimeRelease,
			{}
		);
		await ctx.runMutation(internal.settings.recordRuntimeRelease, {
			image: release.image,
			version: release.version
		});
	}
});
