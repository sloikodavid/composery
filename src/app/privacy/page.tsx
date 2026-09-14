import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Privacy · Composery" };

export default function PrivacyPage() {
	return (
		<LegalPage title="Privacy">
			<p>The privacy policy is not published yet.</p>
		</LegalPage>
	);
}
