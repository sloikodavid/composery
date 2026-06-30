import type { ReactNode } from "react";
import { Header } from "@/components/header";

// The marketing/app chrome: the floating Header pill plus the width-constrained
// content column. Lives in this route group (not the root layout) so the /docs
// subtree can render full-width under fumadocs' own chrome instead.
export default function SiteLayout({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-screen flex-col">
			<Header />
			<main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:px-6">
				{children}
			</main>
		</div>
	);
}
