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

// What the dialog lists, and how each row reads itself off an inspection. The
// label and description do not depend on the box, so the dialog can lay every
// row out before the check returns and fill in only the state - the list never
// changes height, which is what stops the modal resizing under the pointer.
export const CHECKS: {
	label: string;
	description: string;
	read: (status: RecoveryStatus) => Check["state"];
}[] = [
	{
		label: "Website",
		description: "Reachable at its public URL.",
		read: (status) =>
			status.httpReachable
				? { label: "Online", tone: "ok" }
				: { label: "Not responding", tone: "bad" }
	},
	{
		label: "Server",
		description: "The host it runs on.",
		read: (status) =>
			status.hostReachable
				? { label: "Reachable", tone: "ok" }
				: { label: "Unreachable", tone: "bad" }
	},
	{
		label: "Docker",
		description: "Container engine.",
		read: (status) => serviceState(status.docker)
	},
	{
		label: "Reverse proxy",
		description: "Terminates HTTPS at the edge.",
		read: (status) => serviceState(status.outerCaddy)
	},
	{
		label: "Runtime container",
		description: "Everything runs in here.",
		read: (status) => serviceState(status.composery)
	},
	{
		label: "Editor",
		description: "The editor and terminal.",
		read: (status) => serviceState(status.ide)
	},
	{
		label: "Web server",
		description: "Serves the editor.",
		read: (status) => serviceState(status.caddy)
	},
	{
		label: "Persistence",
		description: "Saves your files.",
		read: (status) => serviceState(status.persistence)
	},
	{
		label: "Disk",
		description: "Space in use.",
		read: (status) => diskState(status.diskUsedPercent)
	},
	{
		label: "Persistence engine",
		description: "How your changes are saved.",
		read: (status) => engineState(status.engine)
	}
];

export function buildChecks(status: RecoveryStatus): Check[] {
	return CHECKS.map((check) => ({
		label: check.label,
		description: check.description,
		state: check.read(status)
	}));
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
