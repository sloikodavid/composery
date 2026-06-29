"use client";

import { TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { cn } from "@/lib/cn";
import { bricolage, inter } from "./fonts";
import "./global.css";

type GlobalErrorProps = {
	error: Error & { digest?: string };
	reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
	useEffect(() => {
		console.error(error);
	}, [error]);

	return (
		<html lang="en" className={cn(inter.variable, bricolage.variable)}>
			<body>
				<main className="flex min-h-screen items-center justify-center bg-fd-background px-4 text-fd-foreground">
					<section className="w-full max-w-md space-y-4 text-center">
						<TriangleAlertIcon className="mx-auto size-8 text-fd-muted-foreground" />
						<h1 className="font-heading text-2xl font-semibold">
							Something went wrong
						</h1>
						<p className="text-sm leading-6 text-fd-muted-foreground">
							The app failed to load. Try again, or come back in a moment.
						</p>
						<button
							type="button"
							onClick={reset}
							className="inline-flex h-8 items-center rounded-2xl bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/80"
						>
							Try again
						</button>
					</section>
				</main>
			</body>
		</html>
	);
}
