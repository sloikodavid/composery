import type { RecoveryStatus } from "@/convex/boxes/boxRecoveryTypes";

// What the Repair dialog makes of a runtime inspection. `muted` means "we could
// not read this", never "this is fine" - `summarize` leans on that distinction
// to keep an unread box from reporting itself healthy.
export type Tone = "ok" | "warn" | "bad" | "muted";

export type Check = {
	label: string;
	description: string;
	state: { label: string; tone: Tone };
};

type ComponentState = RecoveryStatus["docker"];

export function serviceState(state: ComponentState): {
	label: string;
	tone: Tone;
} {
	switch (state) {
		case "active":
			return { label: "Running", tone: "ok" };
		case "inactive":
			return { label: "Stopped", tone: "warn" };
		case "missing":
			return { label: "Missing", tone: "bad" };
		default:
			return { label: "Unknown", tone: "muted" };
	}
}

export function diskState(percent: number | null): {
	label: string;
	tone: Tone;
} {
	if (percent === null) return { label: "Unknown", tone: "muted" };
	return {
		label: `${percent}% used`,
		tone: percent >= 90 ? "bad" : percent >= 75 ? "warn" : "ok"
	};
}

// Informational, not pass/fail: both engines are healthy answers, so neither is
// an issue. Only the daemon can name the live engine, so an unreadable one is
// `muted` ("we could not read this") like every other unread check - never a
// guess at which engine is running.
export function engineState(engine: RecoveryStatus["engine"]): {
	label: string;
	tone: Tone;
} {
	if (engine === "overlay") return { label: "Overlay", tone: "ok" };
	if (engine === "copy") return { label: "Copy", tone: "ok" };
	return { label: "Unknown", tone: "muted" };
}

export function buildChecks(status: RecoveryStatus): Check[] {
	return [
		{
			label: "Website",
			description: "Reachable at its public URL.",
			state: status.httpReachable
				? { label: "Online", tone: "ok" }
				: { label: "Not responding", tone: "bad" }
		},
		{
			label: "Server",
			description: "The host it runs on.",
			state: status.hostReachable
				? { label: "Reachable", tone: "ok" }
				: { label: "Unreachable", tone: "bad" }
		},
		{
			label: "Docker",
			description: "Container engine.",
			state: serviceState(status.docker)
		},
		{
			label: "Reverse proxy",
			description: "Terminates HTTPS at the edge.",
			state: serviceState(status.outerCaddy)
		},
		{
			label: "Runtime container",
			description: "Everything runs in here.",
			state: serviceState(status.composery)
		},
		{
			label: "Editor",
			description: "The editor and terminal.",
			state: serviceState(status.ide)
		},
		{
			label: "Web server",
			description: "Serves the editor.",
			state: serviceState(status.caddy)
		},
		{
			label: "Persistence",
			description: "Saves your files.",
			state: serviceState(status.persistence)
		},
		{
			label: "Disk",
			description: "Space in use.",
			state: diskState(status.diskUsedPercent)
		},
		{
			label: "Persistence engine",
			description: "How your changes are saved.",
			state: engineState(status.engine)
		}
	];
}

export function summarize(
	status: RecoveryStatus,
	checks: Check[]
): { label: string; tone: Tone } {
	if (!status.hostReachable) {
		return { label: "The box is unreachable", tone: "bad" };
	}
	const issues = checks.filter(
		(check) => check.state.tone === "bad" || check.state.tone === "warn"
	).length;
	if (issues > 0) {
		return {
			label: `${issues} ${issues === 1 ? "issue" : "issues"} found`,
			tone: "warn"
		};
	}
	// An unread check is not a passing one. SSH can succeed while the probe
	// itself comes back empty, and calling that "healthy" is the one answer the
	// dialog must never give a box the owner came here to fix.
	if (checks.some((check) => check.state.tone === "muted")) {
		return { label: "Some checks could not be read", tone: "warn" };
	}
	return { label: "Everything looks healthy", tone: "ok" };
}
