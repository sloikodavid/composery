import type { Metadata } from "next";
import {
	LegalPage,
	LegalSection,
	legalLinkClass
} from "@/components/legal-page";
import { GITHUB_REPO_URL } from "@/lib/links";

export const metadata: Metadata = { title: "Licences" };

export default function LicensesPage() {
	return (
		<LegalPage title="Licences">
			<LegalSection title="Composery source code">
				<p>
					Composery’s original source code is available under the Apache
					License, Version 2.0. The full licence and copyright notice are
					included in the{" "}
					<a
						className={legalLinkClass}
						href={GITHUB_REPO_URL + "/blob/main/LICENSE"}
						rel="noreferrer"
						target="_blank"
					>
						repository LICENSE file
					</a>
					. The licence does not grant rights to Composery trademarks or
					branding.
				</p>
			</LegalSection>
			<LegalSection title="Upstream and third-party software">
				<p>
					The self-hosted distribution includes a fork of code-server, Visual
					Studio Code components, fonts, libraries, and extensions under their
					respective licences and notices. Those upstream terms continue to
					apply to their components. Source distributions retain the applicable
					licence and NOTICE files; bundled notices accompany release artifacts
					where required.
				</p>
			</LegalSection>
			<LegalSection title="Hosted service">
				<p>
					The open-source licence grants rights in the software, not a right to
					use Composery Cloud without paying applicable service fees. Hosted use
					is governed by the Terms of Service.
				</p>
			</LegalSection>
		</LegalPage>
	);
}
