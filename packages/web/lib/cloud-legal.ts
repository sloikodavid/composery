// The legal documents' identity, and what customers were told when it changed.
//
// One version string serves both halves of that sentence: the Terms, Privacy and
// Cookie pages print it as their last-updated date, and a paid order records it
// as the version the buyer agreed to. Those were two hand-written constants
// until they disagreed - the pages said "21 July 2026" while every order was
// stamped `2026-07-16` - which is the worst shape this can take, because an
// acceptance record naming a version the site never displayed is evidence of
// nothing.

// Every version of the legal documents, oldest first.
//
// A revision is a real change to what the Terms, Privacy Policy or Cookie Notice
// say - not a typo fix, which does not move the date customers see. Append a
// version here and you have committed to announcing it: `LEGAL_NOTICES` must
// carry the notice that tells existing customers, and
// `tests/invariants/legal/notices.test.ts` fails until it does. That binding is
// the point. The obligation to tell people is not something anyone should have
// to remember at the moment they are editing prose.
//
// The first version needs no notice because it supersedes nothing. That is a
// property of being first rather than an exception granted to it, so the rule
// stays absolute: every version with a predecessor has a notice naming it.
export const LEGAL_VERSIONS = ["2026-07-16"] as const;

export const LEGAL_VERSION = LEGAL_VERSIONS[
	LEGAL_VERSIONS.length - 1
] as string;

// This slug is configured as a required checkbox on the Polar Cloud product.
// Never change its meaning in place: create a new field and bump its version so
// a historic `true` always has one unambiguous meaning.
export const TERMS_FIELD_SLUG = "composery-terms-v1";

// What the legal pages print. Derived rather than written, so the date on the
// page and the version on an order cannot drift apart again.
export function legalUpdatedLabel(version = LEGAL_VERSION) {
	return new Date(`${version}T00:00:00Z`).toLocaleDateString("en-IE", {
		day: "numeric",
		month: "long",
		timeZone: "UTC",
		year: "numeric"
	});
}

export type LegalNotice = {
	// Stable for ever. It is what a recipient row records, so reusing an id
	// silently marks people as told about something they never received, and
	// renaming one re-mails everybody.
	id: string;
	// The version from `LEGAL_VERSIONS` this notice announces, where it announces
	// one. A notice that is not about a document revision - a personal data
	// breach is the case this exists for - leaves it out.
	version?: string;
	subject: string;
	text: string;
};

// Notices mailed individually to every account holder. Append-only.
//
// Deploying an entry here is what sends it: there is deliberately no console
// button and no free-text field. The text of a legal notice is reviewed prose
// with consequences, so it belongs in a commit next to the document it
// announces, not in a textarea behind a button that mails every customer at
// once. A notice sends once per account, to the accounts that existed when the
// send began, and re-deploying is a no-op.
//
// Two things go in here and nothing else does:
//
//   - **A document revision that affects an existing customer.** Composery Cloud
//     is a digital service under Directive (EU) 2019/770, transposed in Ireland
//     by the Consumer Rights Act 2022. Article 19 lets a trader modify the
//     service over the contract's life, but where the change negatively affects
//     the customer's access or use by more than a minor degree, they must be
//     informed "reasonably in advance on a durable medium" of what is changing,
//     when, and of their right to terminate free of charge within 30 days.
//     Email is a durable medium; a page on this website is not, because the
//     trader can rewrite it and the reader cannot store an unchanged copy. So a
//     notice is the only mechanism that discharges this, and a banner would not
//     be - which is also why there is no banner.
//
//   - **A personal data breach the customer has to hear about.** GDPR Article 34
//     requires communicating a breach directly to each affected person, without
//     undue delay, whenever it is likely to result in a high risk to their
//     rights and freedoms. Public communication substitutes only where
//     individual contact "would involve disproportionate effort", which is not
//     the case for a fleet whose every customer has a verified address on file.
//
// A notice announcing a revision has to carry, in the customer's own terms, what
// is changing, when it takes effect, and that they may terminate. Write it into
// `text` in full: this array is the record of what was said, and the sent copy
// stored against each notice is taken from it.
export const LEGAL_NOTICES: readonly LegalNotice[] = [];
