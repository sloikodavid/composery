"use client";

import { ConvexError } from "convex/values";
import { ConstructionIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { PageTemplate } from "@/components/page-template";
import { Button } from "@/components/button";
import { Card, CardContent } from "@/components/card";

type ErrorPageProps = {
	error: Error & { digest?: string };
	reset: () => void;
};

function accountSuspensionReason(error: unknown): string | null {
	if (!(error instanceof ConvexError)) return null;
	const data = error.data as { kind?: string; reason?: string } | undefined;
	if (data?.kind !== "user_suspended") return null;
	return data.reason ?? "";
}

export default function BoxesError({ error, reset }: ErrorPageProps) {
	const suspensionReason = accountSuspensionReason(error);

	useEffect(() => {
		if (suspensionReason === null) console.error(error);
	}, [error, suspensionReason]);

	if (suspensionReason !== null) {
		return (
			<PageTemplate
				breadcrumbs={[{ icon: ConstructionIcon, label: "Account suspended" }]}
			>
				<Card className="border-warning/40 bg-warning/5">
					<CardContent className="flex gap-3">
						<ConstructionIcon className="mt-0.5 size-5 shrink-0 text-warning" />
						<div className="space-y-1">
							<p className="font-medium text-foreground">
								Your account is suspended
							</p>
							<p className="text-sm text-muted-foreground">
								{suspensionReason ||
									"Contact support if you think this is a mistake."}
							</p>
						</div>
					</CardContent>
				</Card>
			</PageTemplate>
		);
	}

	return (
		<PageTemplate
			actions={
				<Button className="w-full sm:w-auto" onClick={reset}>
					Try again
				</Button>
			}
			breadcrumbs={[{ icon: TriangleAlertIcon, label: "Something went wrong" }]}
		>
			<p className="text-sm text-muted-foreground">
				The page failed to load. Try again, or come back in a moment.
			</p>
		</PageTemplate>
	);
}
