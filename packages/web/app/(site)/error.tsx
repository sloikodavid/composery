"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { PageTemplate } from "@/components/page-template";
import { Button } from "@/components/button";

type ErrorPageProps = {
	error: Error & { digest?: string };
	reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
	useEffect(() => {
		console.error(error);
	}, [error]);

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
