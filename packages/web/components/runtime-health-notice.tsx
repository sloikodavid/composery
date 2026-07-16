"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/card";

const CHECK_INTERVAL_MS = 30_000;

export function RuntimeHealthNotice({
	check,
	detail,
	status
}: {
	check: () => Promise<{ reachable: boolean }>;
	detail: string;
	status: string;
}) {
	const [reachable, setReachable] = useState<boolean | null>(null);
	const inFlight = useRef(false);

	const runCheck = useCallback(async () => {
		if (inFlight.current) return;
		inFlight.current = true;
		try {
			const result = await check();
			setReachable(result.reachable);
		} catch {
			setReachable(null);
		} finally {
			inFlight.current = false;
		}
	}, [check]);

	useEffect(() => {
		if (status !== "running") return;

		const initial = setTimeout(() => void runCheck(), 0);
		const timer = setInterval(() => void runCheck(), CHECK_INTERVAL_MS);
		return () => {
			clearTimeout(initial);
			clearInterval(timer);
		};
	}, [runCheck, status]);

	if (status !== "running" || reachable !== false) return null;

	return (
		<Card className="border-warning/40 bg-warning/5">
			<CardContent className="flex gap-3 py-3">
				<TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-warning" />
				<div className="text-sm">
					<p className="font-medium text-foreground">
						The box website is not responding.
					</p>
					<p className="text-muted-foreground">{detail}</p>
				</div>
			</CardContent>
		</Card>
	);
}
