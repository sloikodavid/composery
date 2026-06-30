import type { Metadata } from "next";
import { ConsoleBoxActions } from "./_components/console-box-actions";
import { ConsoleBoxDetail } from "./_components/console-box-detail";
import { ConsoleBoxLinks } from "./_components/console-box-links";
import { PageTemplate } from "@/components/page-template";
import { notFoundIfNotStaff } from "@/lib/route-guards";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Console Box",
	robots: { index: false, follow: false }
};

export default async function ConsoleBoxPage({
	params
}: {
	params: Promise<{ slug: string }>;
}) {
	const { slug } = await params;
	await notFoundIfNotStaff();

	return (
		<PageTemplate
			actions={<ConsoleBoxActions slug={slug} />}
			breadcrumbs={[
				{ href: "/console", icon: "layout-grid", label: "Console" },
				{
					label: (
						<span className="inline-flex items-center gap-1">
							{slug}
							<ConsoleBoxLinks slug={slug} />
						</span>
					)
				}
			]}
		>
			<ConsoleBoxDetail slug={slug} />
		</PageTemplate>
	);
}
