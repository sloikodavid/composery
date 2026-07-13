import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
	title: "Privacy Policy",
	description: "How Composery Cloud collects, uses, shares, and retains data."
};

export default function PrivacyPage() {
	return (
		<LegalPage title="Privacy Policy">
			<p>
				This policy applies to composery.io and the hosted Composery Cloud
				service. David Sloiko, trading as Composery in Ireland, is the data
				controller for that service. A person or organisation running the
				open-source software themselves is responsible for their own deployment
				and is a separate controller.
			</p>
			<LegalSection title="What we collect">
				<ul className="list-disc space-y-2 pl-5">
					<li>
						Account data: your Clerk user identifier, email address,
						authentication and security information, and account settings.
					</li>
					<li>
						Billing data: Polar customer, checkout, and subscription
						identifiers, payment status, and transaction records. Composery does
						not receive your full card number.
					</li>
					<li>
						Service data: box name, server and network identifiers, location and
						type, lifecycle history, snapshots, operational errors, and sampled
						CPU, disk, and network metrics.
					</li>
					<li>
						Security data: IP address and request information may appear in
						provider security logs. Password breach checks send only the first
						five characters of a SHA-1 hash to Have I Been Pwned. Box passwords
						are sent to Composery to create the service but are stored only as a
						one-way hash.
					</li>
					<li>
						Website measurements: Vercel Web Analytics and Speed Insights
						provide cookieless, anonymized traffic and performance information,
						including page, referrer, browser, device, country, and web-vital
						data. Web Analytics derives a visitor hash that resets daily.
					</li>
				</ul>
			</LegalSection>
			<LegalSection title="Why we use it">
				<p>
					We process account, billing, and service data because it is necessary
					to enter into and perform our contract with you: authenticating you,
					creating and operating boxes, taking payment, providing support, and
					deleting the service. We use operational, security, abuse-prevention,
					and aggregated measurement data for our legitimate interests in
					keeping the service secure, reliable, and understandable. We keep tax,
					accounting, and compliance records where required by law.
				</p>
			</LegalSection>
			<LegalSection title="Providers and international transfers">
				<p>
					We disclose only the data needed to Clerk (identity), Convex
					(application backend), Polar (merchant of record and billing), Hetzner
					(European cloud infrastructure and snapshots), Cloudflare (DNS and
					network services), Vercel (website hosting and cookieless
					measurements), Resend (operational email), and Have I Been Pwned
					(k-anonymous password checks). These providers process data under
					their own terms and/or our processor agreements. Where data leaves the
					EEA or UK, we rely on an adequacy decision or appropriate contractual
					safeguards supplied by the provider.
				</p>
			</LegalSection>
			<LegalSection title="Retention and deletion">
				<p>
					We retain live account and service records while your account or a box
					is active. Metrics, operational events, and other diagnostic records
					are kept only as long as needed to run, secure, and diagnose the
					service, and are then removed or aggregated; snapshots expire under
					the retention schedule shown in the app. Deleting your Clerk account
					cancels subscriptions, deletes boxes and snapshots, removes checkout
					secrets and URLs, and replaces the email in our application database
					with a non-identifying placeholder. Providers may retain limited
					backups, fraud, transaction, and statutory records for their
					applicable retention periods.
				</p>
			</LegalSection>
			<LegalSection title="Your rights">
				<p>
					Depending on where you live, you may ask for access, correction,
					deletion, restriction, portability, or an objection to processing. You
					may complain to the Irish Data Protection Commission or your local
					supervisory authority. Email{" "}
					<a className="link" href="mailto:hello@composery.io">
						hello@composery.io
					</a>{" "}
					to exercise a right. We may need to check your identity. You can also
					manage or delete your account from the Clerk user menu.
				</p>
			</LegalSection>
			<LegalSection title="Cookies and changes">
				<p>
					See our{" "}
					<Link className="link" href="/cookies">
						Cookie Notice
					</Link>
					. We will update this notice when our processing changes and show the
					new date above. Material changes affecting an active account will be
					brought to your attention through the service or by email where
					appropriate.
				</p>
			</LegalSection>
		</LegalPage>
	);
}
