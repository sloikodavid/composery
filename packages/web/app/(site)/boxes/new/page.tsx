import type { Metadata } from "next";
import { NewBoxForm } from "./_components/new-box-form";
import { PageTemplate } from "@/components/page-template";
import { redirectIfSignedOut } from "@/lib/route-guards";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "New Box"
};

export default async function NewBoxPage() {
	await redirectIfSignedOut("/boxes/new");

	return (
		<PageTemplate
			breadcrumbs={[
				{ href: "/boxes", icon: "washing-machine", label: "Boxes" },
				{ label: "New" }
			]}
		>
			<NewBoxForm />
		</PageTemplate>
	);
}
