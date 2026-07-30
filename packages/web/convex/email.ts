import { Resend } from "@convex-dev/resend";
import { components, internal } from "./_generated/api";
import { optionalEnv } from "./env";

// The deployment's one mail client, and the one answer to "can this deployment
// send that?".
//
// Two senders ride it - staff alerts (convex/staff/alerts.ts) and box owner
// notices (convex/ownerEmail.ts) - and both need the same two things to be true
// before anything can leave: a Resend key, and a verified from-address for that
// class of mail. Asking that question in one place is what stops a caller from
// checking half of it.

// Built per use rather than once at module load.
//
// The client captures `RESEND_API_KEY` when it is constructed, while every "is
// email configured" answer below reads the variable when it is asked. A client
// built at import time makes those two disagree for as long as a deployment's
// module cache outlives an environment change - the configured-looking half
// reporting healthy while the sending half throws "API key is not set". One of
// them had to move, and this one is free to move: a client is a component handle
// beside a plain config object, and the config it sends is assembled per call
// regardless.
export function resendClient(): Resend {
	return new Resend(components.resend, {
		onEmailEvent: internal.staff.alerts.recordEmailEvent,
		testMode: false
	});
}

// The from-address for a class of mail, or `undefined` where this deployment
// cannot send it. A missing key and a missing sender are the same answer,
// because either one alone sends nothing.
//
// One function per class rather than one taking the variable's name, so every
// read stays an `optionalEnv` call on a spelled-out name: the `.env.example`
// checklist test scans the source for exactly that shape, and a name arriving as
// an argument is invisible to it - which is how a documented variable turns into
// one nothing reads.
export function alertSender() {
	return optionalEnv("RESEND_API_KEY")
		? optionalEnv("ALERT_EMAIL_FROM")
		: undefined;
}

export function ownerSender() {
	return optionalEnv("RESEND_API_KEY")
		? optionalEnv("OWNER_EMAIL_FROM")
		: undefined;
}

// Whether Resend can tell us what became of a message it accepted. Without the
// webhook secret the `/resend/events` route has nothing to verify against, so no
// delivery event ever arrives and every message stays at "handed over".
export function emailDeliveryTracked() {
	return Boolean(optionalEnv("RESEND_WEBHOOK_SECRET"));
}
