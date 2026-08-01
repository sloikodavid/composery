"use node";

import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { internalAction, type ActionCtx } from "../../_generated/server";
import { requiredEnv, runtimeDomain, websiteOrigin } from "../../env";
import { vRecoveryStatus, type RecoveryStatus } from "../../model/box/recovery";
import {
	renderComposeryEnv,
	renderCaddyfile,
	renderRuntimeArtifacts
} from "./runtimeArtifacts";
import {
	INSPECT_SCRIPT,
	UNREACHABLE_STATUS,
	applyRuntimeConfigScript,
	bootstrapScript,
	copyFromParkingScript,
	copyToParkingScript,
	measureUsageScript,
	parseParkingVerification,
	parseRuntimeInspection,
	reloadCaddyfileScript,
	repairScript,
	rewritePasswordScript,
	runtimeLogsScript,
	unmountParkingScript,
	updateScript,
	verifyParkingScript
} from "./sshScripts";
import { privateKey } from "./sshKeys";
import { HOUR_MS, MINUTE_MS } from "../../time";
import { runSsh, type SshTarget } from "./sshTransport";

export { runSsh } from "./sshTransport";

// The port the editor listens on inside the box, read from the deployment's own
// configuration. A non-integer or non-positive value would be rendered straight
// into a compose file and a Caddyfile, so it is refused here rather than
// producing a host that boots into a broken proxy.
export function runtimePort() {
	const value = Number(requiredEnv("RUNTIME_PORT"));
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error("RUNTIME_PORT must be a positive integer.");
	}
	return value;
}

// How many lines of runtime log to fetch. Clamped rather than trusted: the log
// stream is read over SSH into memory, so the ceiling is what keeps a caller
// asking for a million lines from being a request the action cannot survive.
export function logTail(value: number) {
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error("Log tail must be a positive integer.");
	}
	return Math.min(value, 5000);
}

export function sshTarget(host: string): SshTarget {
	return {
		host,
		username: requiredEnv("SSH_USER"),
		privateKey: privateKey()
	};
}

export const inspectRuntime = internalAction({
	args: { boxId: v.id("boxes") },
	returns: vRecoveryStatus,
	handler: async (ctx, args): Promise<RecoveryStatus> => {
		const box = await ctx.runQuery(
			internal.fleet.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		if (!box.hetzner_ipv4) return UNREACHABLE_STATUS;

		try {
			const { stdout } = await runSsh(
				sshTarget(box.hetzner_ipv4),
				INSPECT_SCRIPT,
				{ maxOutputBytes: 64 * 1024, timeoutMs: 20_000 }
			);
			return parseRuntimeInspection(stdout);
		} catch {
			return UNREACHABLE_STATUS;
		}
	}
});

// The runtime files a box's SSH scripts write, built from its current row. One
// place so bootstrap and a repair's steps can never render them differently.
//
// `runtimeImage` overrides the row for the one operation that is deliberately
// writing a compose file the row does not describe yet: an update renders the
// image it is moving *to*, while `box.runtime_image` still records the last
// image known to serve. The row is only advanced once the new one has answered
// (see `updateBox`), which is what makes a failed update leave a compose file
// Repair can roll back from.
export function runtimeArtifactsForBox(
	box: Doc<"boxes">,
	runtimeImage?: string
) {
	const image = runtimeImage ?? box.runtime_image;
	if (!image) {
		throw new Error("Box has no runtime image.");
	}
	return renderRuntimeArtifacts({
		cloudBoxId: box._id,
		cloudOrigin: websiteOrigin(),
		config: box.runtime_config,
		domain: runtimeDomain(box.slug),
		runtimeAuthHash: box.runtime_auth_hash,
		runtimeImage: image,
		runtimePort: runtimePort()
	});
}

// One data-preserving repair for a wedged box: rewrite the runtime files (in
// case they were damaged), re-pull the image, and force-recreate the stack. The
// box's files live in named volumes and are untouched.
export const repairRuntime = internalAction({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.fleet.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for repair.");
		}
		const artifacts = runtimeArtifactsForBox(box);

		await runSsh(sshTarget(box.hetzner_ipv4), repairScript(artifacts));
	}
});

// Move a running box to `runtimeImage`, keeping its files. The named volumes are
// untouched and the host is not rebuilt, so this is a container recreate: write
// the compose file naming the new image, pull it, bring the stack up, and hold
// until the editor answers.
//
// The image is passed in rather than read from the row on purpose. The caller
// only advances `box.runtime_image` after this returns, so if any step here
// throws, the row still names the image that last served and Repair - which
// renders from the row - rewrites the old compose file and puts the box back.
// That is the whole rollback mechanism; there is no separate one.
export const updateRuntime = internalAction({
	args: {
		boxId: v.id("boxes"),
		runtimeImage: v.string()
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.fleet.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for update.");
		}
		const artifacts = runtimeArtifactsForBox(box, args.runtimeImage);

		await runSsh(sshTarget(box.hetzner_ipv4), updateScript(artifacts));
	}
});

export const bootstrapRuntime = internalAction({
	args: {
		boxId: v.id("boxes")
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.fleet.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for SSH bootstrap.");
		}
		const artifacts = runtimeArtifactsForBox(box);

		await runSsh(sshTarget(box.hetzner_ipv4), bootstrapScript(artifacts));
	}
});

// Apply an owner's configuration: rewrite the env file with it, recreate the
// editor's container so the new environment is actually read, and hold until the
// editor answers.
//
// The container recreate is not optional. Every variable here is read from
// `process.env` when the editor process starts, so a saved configuration that
// did not restart the container would be a setting the interface reports as
// applied and the box does not have - the inert path this repo treats as worse
// than a failure.
//
// Only the `composery` service is recreated (`--no-deps`), so Caddy and its TLS
// state are left alone; the second `up -d` puts back anything that stopped.
// Like an update, the config is passed in rather than read from the row: the
// caller advances the row only after this returns, so a failed apply leaves the
// box - and every later Repair, which renders from the row - on the last
// configuration known to boot.
export const applyRuntimeConfig = internalAction({
	args: {
		boxId: v.id("boxes"),
		config: v.record(v.string(), v.string())
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.fleet.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for configuration.");
		}

		const env = renderComposeryEnv({
			cloudBoxId: box._id,
			cloudOrigin: websiteOrigin(),
			config: args.config,
			runtimeAuthHash: box.runtime_auth_hash,
			runtimeImage: box.runtime_image
		});

		await runSsh(sshTarget(box.hetzner_ipv4), applyRuntimeConfigScript(env));
	}
});

export const rewritePasswordAndRestart = internalAction({
	args: {
		boxId: v.id("boxes"),
		runtimeAuthHash: v.string()
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.fleet.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for password change.");
		}

		const env = renderComposeryEnv({
			cloudBoxId: box._id,
			cloudOrigin: websiteOrigin(),
			config: box.runtime_config,
			runtimeAuthHash: args.runtimeAuthHash,
			runtimeImage: box.runtime_image
		});
		await runSsh(
			sshTarget(box.hetzner_ipv4),
			rewritePasswordScript(env, args.runtimeAuthHash)
		);
	}
});

export const fetchRuntimeLogs = internalAction({
	args: {
		boxId: v.id("boxes"),
		tail: v.number()
	},
	handler: async (ctx, args): Promise<string> => {
		const box = await ctx.runQuery(
			internal.fleet.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for log access.");
		}

		const { stdout } = await runSsh(
			sshTarget(box.hetzner_ipv4),
			runtimeLogsScript(logTail(args.tail))
		);
		return stdout;
	}
});

export const reloadSlug = internalAction({
	args: {
		boxId: v.id("boxes"),
		newSlug: v.string()
	},
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.fleet.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);

		if (!box.hetzner_ipv4) {
			throw new Error("Box has no Hetzner IPv4 for slug change.");
		}

		const caddyfile = renderCaddyfile(
			runtimeDomain(args.newSlug),
			runtimePort()
		);
		await runSsh(sshTarget(box.hetzner_ipv4), reloadCaddyfileScript(caddyfile));
	}
});

// -- Repair (clean host, current files) -------------------------------------

export function requireBoxHost(box: Doc<"boxes">) {
	if (!box.hetzner_ipv4) {
		throw new Error(
			"This box has no reachable host. A host with broken networking or SSH can only be recovered by Restore."
		);
	}
	return box.hetzner_ipv4;
}

// Repair's precondition: the host must answer over SSH. A host whose networking
// or sshd is broken cannot be reached by any of the repair steps, so we say so
// up front rather than failing five steps in - Restore is the tool for that box.
export const requireReachableHost = internalAction({
	args: { boxId: v.id("boxes") },
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.fleet.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		const host = requireBoxHost(box);
		try {
			await runSsh(sshTarget(host), "true", { timeoutMs: 30_000 });
		} catch (error) {
			throw new Error(
				`This box's host is not reachable over SSH, so it cannot be repaired. Restore it instead. (${error instanceof Error ? error.message : String(error)})`
			);
		}
	}
});

export const measureParkingUsage = internalAction({
	args: { boxId: v.id("boxes") },
	returns: v.object({ usedBytes: v.number() }),
	handler: async (ctx, args): Promise<{ usedBytes: number }> => {
		const box = await ctx.runQuery(
			internal.fleet.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		const host = requireBoxHost(box);
		const { stdout } = await runSsh(sshTarget(host), measureUsageScript(), {
			maxOutputBytes: 64 * 1024,
			timeoutMs: 5 * MINUTE_MS
		});
		const match = stdout.match(/used_bytes=(\d+)/);
		if (!match) {
			throw new Error("Could not measure the box's volume usage.");
		}
		return { usedBytes: Number(match[1]) };
	}
});

export const copyToParking = internalAction({
	args: { boxId: v.id("boxes"), volumeId: v.number() },
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.fleet.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		const host = requireBoxHost(box);
		await runSsh(sshTarget(host), copyToParkingScript(args.volumeId), {
			timeoutMs: HOUR_MS
		});
	}
});

// Copy the parked files back onto the rebuilt host. Writes the runtime files,
// materializes the empty volumes, and rsyncs the parked copy in - all before the
// stack is brought up, so nothing writes to a volume until its files are back.
export const copyFromParking = internalAction({
	args: { boxId: v.id("boxes"), volumeId: v.number() },
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.fleet.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		const host = requireBoxHost(box);
		const artifacts = runtimeArtifactsForBox(box);
		await runSsh(
			sshTarget(host),
			copyFromParkingScript(artifacts, args.volumeId),
			{ timeoutMs: HOUR_MS }
		);
	}
});

async function verifyParking(
	ctx: ActionCtx,
	boxId: Doc<"boxes">["_id"],
	direction: "out" | "back",
	volumeId: number
) {
	const box = await ctx.runQuery(
		internal.fleet.queries.getBoxLifecycleSnapshot,
		{ boxId }
	);
	const host = requireBoxHost(box);
	const { stdout } = await runSsh(
		sshTarget(host),
		verifyParkingScript(direction, volumeId),
		{ maxOutputBytes: 4 * 1024 * 1024, timeoutMs: HOUR_MS }
	);
	const diffs = parseParkingVerification(stdout);
	const failure = parkingVerificationFailure(direction, diffs);
	if (failure) throw new Error(failure);
}

// The data-safety gate of a repair, as a decision rather than a step.
//
// Any difference at all stops the repair: the copy either matched or it did not,
// and continuing past a mismatch is the one path that ends with an owner's files
// gone. The count is reported in full and the list truncated, because the number
// is what tells an operator how bad it is while a million-line error is one
// nobody reads - and it was unreachable inside the SSH call that produced it.
export const PARKING_DIFFS_SHOWN = 50;

export function parkingVerificationFailure(
	direction: "out" | "back",
	diffs: readonly string[]
) {
	if (diffs.length === 0) return null;
	const shown = diffs.slice(0, PARKING_DIFFS_SHOWN).join("\n");
	return `Parking copy verification (${direction}) found ${diffs.length} difference(s); refusing to continue:\n${shown}`;
}

export const verifyParkingCopy = internalAction({
	args: { boxId: v.id("boxes"), volumeId: v.number() },
	handler: async (ctx, args) => {
		await verifyParking(ctx, args.boxId, "out", args.volumeId);
	}
});

export const verifyParkingBack = internalAction({
	args: { boxId: v.id("boxes"), volumeId: v.number() },
	handler: async (ctx, args) => {
		await verifyParking(ctx, args.boxId, "back", args.volumeId);
	}
});

export const unmountParking = internalAction({
	args: { boxId: v.id("boxes") },
	handler: async (ctx, args) => {
		const box = await ctx.runQuery(
			internal.fleet.queries.getBoxLifecycleSnapshot,
			{ boxId: args.boxId }
		);
		const host = requireBoxHost(box);
		await runSsh(sshTarget(host), unmountParkingScript(), {
			timeoutMs: 5 * MINUTE_MS
		});
	}
});
