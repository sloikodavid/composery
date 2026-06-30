import { WashingMachineIcon } from "lucide-react";
import type { Metadata } from "next";
import { BoxTable } from "./_components/box-table";
import { AnimatedIconLink } from "@/components/animated-icon";
import { PageTemplate } from "@/components/page-template";
import { buttonVariants } from "@/components/button";
import { cn } from "@/lib/utils";
import { redirectIfSignedOut } from "@/lib/route-guards";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Boxes"
};

export default async function BoxesPage() {
	await redirectIfSignedOut("/boxes");

	return (
		<PageTemplate
			actions={
				<AnimatedIconLink
					className={cn("w-full sm:w-auto", buttonVariants())}
					href="/boxes/new"
					icon="plus"
					iconPosition="start"
					prefetch={false}
				>
					New box
				</AnimatedIconLink>
			}
			breadcrumbs={[{ icon: WashingMachineIcon, label: "Boxes" }]}
		>
			<BoxTable />
		</PageTemplate>
	);
}
