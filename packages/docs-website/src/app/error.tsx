"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";

type ErrorPageProps = {
	error: Error & { digest?: string };
	reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
			<TriangleAlertIcon className="mx-auto size-8 text-fd-muted-foreground" />
			<h1 className="mt-4 font-heading text-2xl font-semibold text-fd-foreground">
				Something went wrong
			</h1>
			<p className="mt-2 text-sm leading-6 text-fd-muted-foreground">
				The page failed to load. Try again, or come back in a moment.
			</p>
			<button
				type="button"
				onClick={reset}
				className="mt-4 inline-flex h-8 items-center rounded-2xl bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/80"
			>
				Try again
			</button>
		</main>
	);
}
