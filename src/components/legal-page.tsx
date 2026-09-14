import type { ReactNode } from "react";
import { Container } from "@/components/ui/container";

export function LegalPage({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}) {
	return (
		<main className="flex-1">
			<Container width="narrow" className="flex flex-col gap-4 py-16">
				<h1 className="text-4xl">{title}</h1>
				<div className="text-muted">{children}</div>
			</Container>
		</main>
	);
}
