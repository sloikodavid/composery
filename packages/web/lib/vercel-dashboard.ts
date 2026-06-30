const BASE = process.env.NEXT_PUBLIC_VERCEL_PROJECT_URL?.replace(/\/+$/, "");

export type VercelView = "analytics" | "speed-insights" | "overview";

export function vercelDashboardUrl(view: VercelView = "analytics") {
	if (!BASE) return null;
	return view === "overview" ? BASE : `${BASE}/${view}`;
}
