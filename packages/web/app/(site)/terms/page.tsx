import type { Metadata } from "next";
import Link from "next/link";
import { CopyEmail } from "@/components/copy-email";
import { LegalPage, LegalSection } from "@/components/legal-page";
import { OWNER, WEBSITE_DOMAIN } from "shared";

export const metadata: Metadata = {
	title: "Terms of Service",
	robots: { follow: true, index: false }
};

export default function TermsPage() {
	return (
		<LegalPage title="Terms of Service">
			<p>
				These terms are an agreement between you and {OWNER.legalName}, trading
				as {OWNER.tradingName} in {OWNER.jurisdiction} (“{OWNER.tradingName}”),
				for {WEBSITE_DOMAIN} and Composery Cloud. The self-hosted runtime is
				open-source software distributed under the Apache 2.0 licence. These
				Terms govern the hosted service, not your separate right to use that
				software.
			</p>
			<LegalSection title="Eligibility and accounts">
				<p>
					You must be able to enter this agreement. If you are under 18, you may
					use Composery Cloud only with a parent or legal guardian’s involvement
					and permission; that adult must agree to the paid subscription. Keep
					account credentials secure and provide accurate information. You are
					responsible for activity under your account and must promptly report
					suspected unauthorised access.
				</p>
			</LegalSection>
			<LegalSection title="The service">
				<p>
					Composery Cloud provides a hosted cloud computer and browser-based
					development environment. You retain ownership of content you place in
					a box. You give Composery the limited permission needed to host,
					transmit, back up, secure, and otherwise operate that content for you.
					You are responsible for your content, workloads, backups beyond the
					included snapshot schedule, and compliance with laws that apply to
					your use.
				</p>
			</LegalSection>
			<LegalSection title="Billing and cancellation">
				<p>
					Polar is the merchant of record and authorised reseller. You buy the
					subscription from Polar and license the service from Composery under
					these Terms. Polar checkout shows the price, taxes, billing interval,
					renewal terms, and its buyer terms before payment. Each box renews
					until cancelled.
				</p>
				<p>
					A box stays on the plan it was bought on for its lifetime; plans
					cannot be switched after purchase. Plans differ in the machine behind
					the box and in how many snapshots it keeps, and those figures are the
					ones shown on the pricing page at the time of sale.
				</p>
				<p>
					Normal cancellation through Polar stops renewal and keeps the box
					available until the end of the period already paid for. It does not
					automatically refund that period. An immediate revocation stops access
					now and is also separate from any refund. Refund and cancellation
					requests are handled through Polar, subject to Polar’s buyer terms,
					applicable law, and protections against fraud, abuse, and misuse.
				</p>
				<p>
					If Composery cannot complete initial delivery of a paid box, we revoke
					the subscription and ask Polar to refund the full remaining refundable
					amount of that order. A full refund ends access to the corresponding
					box; a partial refund alone does not. Nothing here limits a mandatory
					consumer right or remedy.
				</p>
			</LegalSection>
			<LegalSection title="Acceptable use">
				<p>
					Do not use the service to break the law or others’ rights; distribute
					malware; gain unauthorised access; facilitate abuse, fraud, spam, or
					harassment; mine cryptocurrency; attack or materially disrupt
					networks; or consume resources in a way that threatens the service or
					others. Do not resell access without written permission. We may
					investigate, rate-limit, suspend, or remove affected boxes when
					reasonably necessary for security, legal compliance, or service
					integrity, and will give reasons where law requires.
				</p>
			</LegalSection>
			<LegalSection title="Availability and changes">
				<p>
					We aim to provide a reliable service but do not promise uninterrupted
					or error-free operation. Features may change. We will give reasonable
					advance notice of a material adverse change or discontinuation where
					practicable. We may update these terms prospectively; material changes
					will be notified through the service or email and will not
					retroactively rewrite an accrued right.
				</p>
			</LegalSection>
			<LegalSection title="Warranties and liability">
				<p>
					Nothing in these terms excludes rights or liability that cannot
					legally be excluded, including mandatory consumer rights, fraud, or
					liability for death or personal injury caused by negligence.
					Otherwise, to the fullest extent permitted by law, the service is
					provided as available; implied warranties are excluded, and Composery
					is not liable for indirect or consequential loss. Composery’s
					aggregate liability arising from the paid service is limited to the
					fees you paid for it in the 12 months before the event, except where
					that limit is prohibited by law.
				</p>
			</LegalSection>
			<LegalSection title="Ending the agreement">
				<p>
					You may stop using the site at any time and can delete your account
					from the user menu. Account deletion immediately revokes subscriptions
					and does not itself refund unused time. It permanently removes box
					contents, servers, credentials, and snapshots. Any refund still
					required by applicable law or agreed through Polar remains unaffected.
					Minimized security, lifecycle, and billing records remain only for the
					periods and purposes described in the Privacy Policy. We may end
					access for a material or repeated breach, non-payment, legal
					requirement, or serious security risk. Terms which by nature survive
					termination, including payment, ownership, disclaimers, and liability
					terms, remain effective.
				</p>
			</LegalSection>
			<LegalSection title="Law and contact">
				<p>
					Irish law governs these terms and Irish courts have jurisdiction,
					without depriving a consumer of mandatory protections or courts
					available in their home country.
				</p>
				<address className="not-italic">
					{OWNER.legalName}, trading as {OWNER.tradingName}
					<br />
					{OWNER.address}
					<br />
					<CopyEmail className="link" />
				</address>
				<p>
					Our{" "}
					<Link className="link" href="/privacy">
						Privacy Policy
					</Link>{" "}
					explains how we handle personal data.
				</p>
			</LegalSection>
		</LegalPage>
	);
}
