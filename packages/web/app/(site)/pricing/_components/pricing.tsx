"use client";

import { useUser } from "@clerk/nextjs";
import { useAction, useConvexAuth, useQuery } from "convex/react";
import {
	AngryIcon,
	ContainerIcon,
	EarthLockIcon,
	FileSearchCornerIcon,
	HistoryIcon,
	type LucideIcon,
	MonitorCogIcon,
	RocketIcon,
	ShieldCheckIcon,
	WalletIcon
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { AnimatedIconButton } from "@/components/animated-icon";
import { buttonVariants } from "@/components/base/button";
import { Faq } from "./faq";
import { FadingText } from "./fading-text";
import { GitHubLogo } from "@/components/icons/github-logo";
import { Input } from "@/components/base/input";
import { PageTemplate } from "@/components/page-template";
import { api } from "@/convex/_generated/api";
import {
	annualSavingsPercent,
	BOX_BILLING,
	type BoxBillingInterval,
	type BoxPricing,
	formatPrice
} from "@/lib/box-billing";
import { isValidSlugFormat, sanitizeSlug } from "@/lib/box-slug";
import { errorMessage } from "@/lib/error-message";
import { GITHUB_REPO_URL } from "@/lib/links";
import { signInUrlForReturnPath } from "@/lib/auth-routing";
import { cn } from "@/lib/utils";

type Feature = { icon: LucideIcon; text: string };

const MANAGED_FEATURES: Feature[] = [
	{ icon: RocketIcon, text: "Ready in a minute" },
	{ icon: ShieldCheckIcon, text: "Privately hosted in Europe" },
	{ icon: EarthLockIcon, text: "Sub-domain, DNS, and HTTPS" },
	{ icon: HistoryIcon, text: "Daily and manual snapshots" }
];

const SELF_HOSTED_FEATURES: Feature[] = [
	{ icon: ContainerIcon, text: "Runs anywhere, just like n8n" },
	{ icon: FileSearchCornerIcon, text: "Fully open-source, no lock-in" },
	{ icon: MonitorCogIcon, text: "Platform-specific hosting templates" },
	{ icon: AngryIcon, text: "You might get a headache" }
];

function BillingSelector({
	billingInterval,
	onChange,
	savingsPercent
}: {
	billingInterval: BoxBillingInterval;
	onChange: (billingInterval: BoxBillingInterval) => void;
	savingsPercent: number | null;
}) {
	return (
		<div
			aria-label="Billing frequency"
			className="flex flex-wrap items-center gap-1.5 text-base font-medium"
			role="group"
		>
			{(["month", "year"] as const).map((interval, index) => {
				const selected = interval === billingInterval;

				return (
					<span className="contents" key={interval}>
						{index > 0 ? (
							<span aria-hidden="true" className="text-muted-foreground">
								/
							</span>
						) : null}
						<button
							aria-pressed={selected}
							className={cn(
								"transition-colors outline-none focus-visible:text-foreground",
								selected
									? "text-foreground"
									: "text-muted-foreground hover:text-foreground"
							)}
							onClick={() => onChange(interval)}
							type="button"
						>
							{BOX_BILLING[interval].label}
							{interval === "year" && savingsPercent !== null ? (
								<span className="text-success"> -{savingsPercent}%</span>
							) : null}
						</button>
					</span>
				);
			})}
		</div>
	);
}

function FeatureList({ features }: { features: Feature[] }) {
	return (
		<ul className="space-y-3.5">
			{features.map(({ icon: Icon, text }) => (
				<li className="flex items-center gap-3 text-sm" key={text}>
					<Icon className="size-4 shrink-0 text-muted-foreground" />
					<span className="text-foreground">{text}</span>
				</li>
			))}
		</ul>
	);
}

function PlanCard({
	children,
	descriptor,
	features,
	name,
	period,
	price
}: {
	children: ReactNode;
	descriptor: string;
	features: Feature[];
	name: string;
	period?: string;
	// Null when Polar has not been read: the card keeps its checkout, and the
	// visitor gets the real figure there, rather than one invented here.
	price: string | null;
}) {
	return (
		<div className="flex flex-col rounded-lg border border-border p-7 sm:p-8">
			<h3 className="font-heading text-2xl font-medium tracking-tight text-foreground">
				{name}
			</h3>
			<p className="mt-1 text-sm text-muted-foreground">{descriptor}</p>

			{price ? (
				<div className="mt-6 flex items-baseline gap-1.5">
					<span className="font-heading text-5xl font-medium tracking-tight text-foreground tabular-nums">
						{price}
					</span>
					{period ? (
						<span className="text-sm text-muted-foreground">{period}</span>
					) : null}
				</div>
			) : null}

			<div className="mt-6">{children}</div>

			<div className="mt-7 border-t border-border pt-7">
				<FeatureList features={features} />
			</div>
		</div>
	);
}

function BoxCheckout({
	billingInterval,
	initialSlug
}: {
	billingInterval: BoxBillingInterval;
	initialSlug: string;
}) {
	const createCheckout = useAction(api.user.checkout.createCheckout);
	const { isAuthenticated, isLoading: authenticationLoading } = useConvexAuth();
	const { user } = useUser();
	// Clerk resolves after mount, so the suggestion is derived rather than
	// seeded into state; typing takes over from then on.
	const [typedSlug, setTypedSlug] = useState<string | null>(
		initialSlug || null
	);
	const [submitting, setSubmitting] = useState(false);
	const suggestedSlug = sanitizeSlug(
		user?.username ??
			user?.primaryEmailAddress?.emailAddress.split("@")[0] ??
			""
	);
	// Checked before it's shown: landing on a prefilled slug that's already
	// taken reads as an error the visitor didn't cause, so an unavailable
	// suggestion just leaves the field empty.
	const suggestionAvailability = useQuery(
		api.user.checkout.slugAvailability,
		typedSlug === null && isValidSlugFormat(suggestedSlug)
			? { slug: suggestedSlug }
			: "skip"
	);
	const slug =
		typedSlug ?? (suggestionAvailability?.available ? suggestedSlug : "");
	const normalizedSlug = sanitizeSlug(slug);
	const slugFormatValid = isValidSlugFormat(normalizedSlug);
	const availability = useQuery(
		api.user.checkout.slugAvailability,
		slugFormatValid ? { slug: normalizedSlug } : "skip"
	);
	const checkoutAvailability = useQuery(api.user.checkout.availability, {});
	const slugAvailable = availability?.available ?? false;
	const slugVisuallyInvalid = normalizedSlug.length > 0 && !slugFormatValid;
	const slugTaken = slugFormatValid && availability != null && !slugAvailable;
	const canCheckout =
		!authenticationLoading &&
		slugFormatValid &&
		slugAvailable &&
		(checkoutAvailability?.available === true ||
			availability?.resumable === true);
	const checkoutUnavailable =
		checkoutAvailability?.available === false && !availability?.resumable;
	// A rejected slug already shows as a red field, so the only words here are
	// for the one state that isn't about the slug at all: no capacity for new
	// boxes.
	const slugError = checkoutUnavailable
		? (checkoutAvailability.message ?? "Unavailable")
		: "";

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canCheckout || submitting) return;

		if (!isAuthenticated) {
			const query = new URLSearchParams({
				billing: billingInterval,
				slug: normalizedSlug
			});
			window.location.assign(
				signInUrlForReturnPath(`/pricing?${query.toString()}`)
			);
			return;
		}

		setSubmitting(true);
		try {
			const checkout = await createCheckout({
				billingInterval,
				slug: normalizedSlug
			});
			window.location.assign(checkout.checkoutUrl);
		} catch (error) {
			toast.error("Checkout could not start", {
				description: errorMessage(error)
			});
			setSubmitting(false);
		}
	}

	return (
		<form className="relative" onSubmit={handleSubmit}>
			<div className="absolute right-0 bottom-full left-0 mb-1 flex min-h-5 items-center justify-end">
				<span
					aria-live="polite"
					className="min-w-0"
					id="box-slug-status"
					title={slugError || undefined}
				>
					<FadingText
						className="max-w-full truncate text-xs font-medium text-destructive"
						text={slugError}
					/>
				</span>
			</div>
			<div className="flex min-w-0 gap-2">
				<Input
					aria-describedby="box-slug-status"
					aria-invalid={slugVisuallyInvalid || slugTaken}
					aria-label="Box slug"
					autoCapitalize="none"
					autoComplete="off"
					autoFocus
					className="h-9 min-w-0 flex-1 rounded-2xl"
					id="box-slug"
					maxLength={63}
					name="slug"
					onChange={(event) => setTypedSlug(sanitizeSlug(event.target.value))}
					pattern="[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?"
					placeholder="my-box"
					spellCheck={false}
					type="text"
					value={slug}
				/>
				<AnimatedIconButton
					className="h-9 shrink-0 rounded-2xl"
					disabled={!canCheckout || submitting}
					icon="arrow-right"
					size="lg"
					type="submit"
				>
					Checkout
				</AnimatedIconButton>
			</div>
		</form>
	);
}

export function Pricing({
	initialBillingInterval,
	initialSlug,
	pricing
}: {
	initialBillingInterval: BoxBillingInterval;
	initialSlug: string;
	pricing: BoxPricing;
}) {
	const [billingInterval, setBillingInterval] = useState(
		initialBillingInterval
	);

	return (
		<PageTemplate
			actions={
				<BillingSelector
					billingInterval={billingInterval}
					onChange={setBillingInterval}
					savingsPercent={annualSavingsPercent(pricing)}
				/>
			}
			breadcrumbs={[{ icon: WalletIcon, label: "Pricing" }]}
		>
			<div className="space-y-8">
				<div className="grid gap-5 md:grid-cols-2">
					<PlanCard
						descriptor="..with a secure + always-on Composery."
						features={MANAGED_FEATURES}
						name="Box"
						period={
							billingInterval === "year"
								? `/ month - billed annually.`
								: "/ month."
						}
						price={formatPrice(pricing[billingInterval], pricing.currency)}
					>
						<BoxCheckout
							billingInterval={billingInterval}
							initialSlug={initialSlug}
						/>
					</PlanCard>

					<PlanCard
						descriptor="Manage your own Composery."
						features={SELF_HOSTED_FEATURES}
						name="Self-hosted"
						price="Free"
					>
						<a
							className={cn(
								"w-full gap-2",
								buttonVariants({ size: "lg", variant: "outline" })
							)}
							href={GITHUB_REPO_URL}
							rel="noreferrer"
							target="_blank"
						>
							<GitHubLogo className="size-4" />
							Go to repo
						</a>
					</PlanCard>
				</div>

				<Faq />
			</div>
		</PageTemplate>
	);
}
