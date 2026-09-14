import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Terms · Composery" };

export default function TermsPage() {
	return (
		<LegalPage title="Terms">
			<p>The terms of service are not published yet.</p>
		</LegalPage>
	);
}
