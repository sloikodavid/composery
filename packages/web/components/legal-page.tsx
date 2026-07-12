import type { ReactNode } from "react";
import { ScaleIcon } from "lucide-react";
import { PageTemplate } from "@/components/page-template";

export const LEGAL_UPDATED = "11 July 2026";

export function LegalPage({
	title,
	children
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<PageTemplate breadcrumbs={[{ icon: ScaleIcon, label: title }]}>
			<article className="mx-auto max-w-3xl space-y-8 text-[15px] leading-7 text-muted-foreground">
				<p className="text-sm">Last updated: {LEGAL_UPDATED}</p>
				{children}
			</article>
		</PageTemplate>
	);
}

export function LegalSection({
	title,
	children
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="space-y-3">
			<h2 className="font-heading text-xl font-medium tracking-tight text-foreground">
				{title}
			</h2>
			{children}
		</section>
	);
}

export const legalLinkClass =
	"text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground";
