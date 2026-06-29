import { SearchXIcon } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
	return (
		<main className="flex min-h-[calc(100svh-var(--fd-nav-height,0px))] flex-col items-center justify-center px-4 text-center">
			<SearchXIcon className="mx-auto size-8 text-fd-muted-foreground" />
			<h1 className="mt-4 font-heading text-2xl font-semibold text-fd-foreground">
				Page not found
			</h1>
			<p className="mt-2 text-sm leading-6 text-fd-muted-foreground">
				This page does not exist.
			</p>
			<Link
				href="/"
				className="mt-4 inline-flex h-8 items-center rounded-2xl bg-fd-primary px-4 text-sm font-medium text-fd-primary-foreground transition-colors hover:bg-fd-primary/80"
			>
				Back to docs
			</Link>
		</main>
	);
}
