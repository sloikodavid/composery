"use client";

import { ConvexError } from "convex/values";
import { ConstructionIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { PageTemplate } from "@/components/page-template";
import { Button } from "@/components/base/button";
import { Card, CardContent } from "@/components/base/card";

type ErrorPageProps = {
	error: Error & { digest?: string };
	reset: () => void;
};

// Every Convex entry point behind these pages refuses a suspended or
// mid-deletion account the same way, and says why in the same two strings (see
// `convex/users.ts` -> AccountBlock). This draws them; it never writes its own
// wording, so the card and the toast an action raises cannot disagree.
function accountBlock(
	error: unknown
): { title: string; detail: string } | null {
	if (!(error instanceof ConvexError)) return null;
	const data = error.data as
		{ kind?: string; title?: string; detail?: string } | undefined;
	if (data?.kind !== "account_unavailable") return null;
	if (!data.title || !data.detail) return null;
	return { title: data.title, detail: data.detail };
}

export default function BoxesError({ error, reset }: ErrorPageProps) {
	const blocked = accountBlock(error);

	useEffect(() => {
		if (!blocked) console.error(error);
	}, [error, blocked]);

	if (blocked) {
		return (
			<PageTemplate
				breadcrumbs={[{ icon: ConstructionIcon, label: blocked.title }]}
			>
				<Card className="border-warning/40 bg-warning/5">
					<CardContent className="flex gap-3">
						<ConstructionIcon className="mt-0.5 size-5 shrink-0 text-warning" />
						<div className="space-y-1">
							<p className="font-medium text-foreground">{blocked.title}</p>
							<p className="text-sm text-muted-foreground">{blocked.detail}</p>
						</div>
					</CardContent>
				</Card>
			</PageTemplate>
		);
	}

	return (
		<PageTemplate
			actions={<Button onClick={reset}>Try again</Button>}
			breadcrumbs={[{ icon: TriangleAlertIcon, label: "Something went wrong" }]}
		>
			<p className="text-sm text-muted-foreground">
				The page failed to load. Try again, or come back in a moment.
			</p>
		</PageTemplate>
	);
}
