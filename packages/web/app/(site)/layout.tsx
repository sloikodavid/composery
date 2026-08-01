import type { ReactNode } from "react";
import { Footer } from "@/ui/footer";
import { Header } from "@/ui/header";

// The marketing/app chrome: the floating Header pill plus the width-constrained
// content column. Lives in this route group (not the root layout) so the /docs
// subtree can render full-width under fumadocs' own chrome instead.
export default function SiteLayout({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-screen flex-col">
			<Header />
			{/* min-h-screen (not flex-1) so the content always fills the viewport
			    and the footer sits below the fold on every page, not just tall ones. */}
			<main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-6 sm:px-6">
				{children}
			</main>
			<Footer />
		</div>
	);
}
