import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = { title: "Cookie Notice" };

export default function CookiesPage() {
	return (
		<LegalPage title="Cookie Notice">
			<p>
				Composery currently uses only storage that is necessary to deliver the
				site and features you request. We do not use advertising cookies or
				cookie-based analytics, so there is no accept/reject banner.
			</p>
			<LegalSection title="Necessary storage">
				<ul className="list-disc space-y-2 pl-5">
					<li>
						Clerk authentication cookies and browser storage keep you signed in,
						protect sessions, and prevent abuse. Their names and duration can
						vary with Clerk configuration and whether you choose a persistent
						session.
					</li>
					<li>
						A local theme preference remembers light, dark, or system
						appearance. This is stored only to provide the setting you select.
					</li>
				</ul>
			</LegalSection>
			<LegalSection title="Cookieless measurement">
				<p>
					Vercel Web Analytics and Speed Insights measure aggregate visits and
					performance without cookies or a persistent cross-site identifier.
					They are not used to build advertising profiles.
				</p>
			</LegalSection>
			<LegalSection title="Your controls">
				<p>
					You can remove site data in your browser settings. Removing
					authentication storage signs you out and may prevent account features
					from working. If we add optional analytics, advertising, or similar
					storage, it will remain off until you choose it and this notice and
					the site controls will be updated first.
				</p>
			</LegalSection>
		</LegalPage>
	);
}
