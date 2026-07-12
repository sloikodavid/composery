import type { Metadata } from "next";
import Link from "next/link";
import {
	LegalPage,
	LegalSection,
	legalLinkClass
} from "@/components/legal-page";

export const metadata: Metadata = {
	title: "Terms of Service",
	robots: { follow: true, index: false }
};

export default function TermsPage() {
	return (
		<LegalPage title="Terms of Service">
			<p>
				These terms are an agreement between you and David Sloiko, trading as
				Composery in Ireland (“Composery”), for composery.io and Composery
				Cloud. They do not replace the Apache 2.0 licence governing the
				separately distributed open-source software.
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
			<LegalSection title="Prices, renewal, and cancellation">
				<ul className="list-disc space-y-2 pl-5">
					<li>
						The price and billing interval shown at checkout include any
						applicable tax treatment shown by Polar. Polar is the merchant of
						record and handles payment, invoices, refunds, and payment
						credentials.
					</li>
					<li>
						Each box is a recurring subscription. It renews until cancelled. You
						can cancel through the billing portal or by deleting the box; access
						continues as indicated during cancellation unless deletion is
						requested immediately.
					</li>
					<li>
						If you are an EEA or UK consumer, you generally have 14 days from
						the contract date to withdraw. If you ask us to start during that
						period, you must pay a proportionate amount for service already
						supplied. To withdraw, email hello@composery.io with your name,
						account email, order, and a clear statement that you withdraw. You
						may use those details as the model withdrawal form, but do not have
						to.
					</li>
				</ul>
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
					from the user menu. Account deletion cancels subscriptions and
					permanently deletes boxes and snapshots. We may end access for a
					material or repeated breach, non-payment, legal requirement, or
					serious security risk. Terms which by nature survive termination,
					including payment, ownership, disclaimers, and liability terms, remain
					effective.
				</p>
			</LegalSection>
			<LegalSection title="Law and contact">
				<p>
					Irish law governs these terms and Irish courts have jurisdiction,
					without depriving a consumer of mandatory protections or courts
					available in their home country.
				</p>
				<address className="not-italic">
					David Sloiko, trading as Composery
					<br />
					20 Templegreen, Newcastle West, Co. Limerick, V42 AH01, Ireland
					<br />
					<a className={legalLinkClass} href="mailto:hello@composery.io">
						hello@composery.io
					</a>
				</address>
				<p>
					Our{" "}
					<Link className={legalLinkClass} href="/privacy">
						Privacy Policy
					</Link>{" "}
					explains how we handle personal data.
				</p>
			</LegalSection>
		</LegalPage>
	);
}
