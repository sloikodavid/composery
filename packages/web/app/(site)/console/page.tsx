import { LayoutGridIcon } from "lucide-react";
import type { Metadata } from "next";
import { ConsoleHome } from "./_components/home";
import { OpenInVercel } from "@/ui/open-in";
import { PageTemplate } from "@/ui/page-template";
import { notFoundIfNotStaff } from "@/ui/lib/route-guards";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Console",
	robots: { index: false, follow: false }
};

export default async function ConsolePage() {
	await notFoundIfNotStaff();

	return (
		<PageTemplate
			actions={<OpenInVercel size="default" />}
			breadcrumbs={[{ icon: LayoutGridIcon, label: "Console" }]}
		>
			<ConsoleHome />
		</PageTemplate>
	);
}
