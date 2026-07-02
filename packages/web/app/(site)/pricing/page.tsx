import type { Metadata } from "next";
import {
	Angry,
	HistoryIcon,
	InfinityIcon,
	type LucideIcon,
	RocketIcon,
	ServerIcon,
	ShieldCheckIcon,
	SmartphoneIcon,
	UsersIcon,
	WalletIcon
} from "lucide-react";
import type { ReactNode } from "react";
import { AnimatedIconLink } from "@/components/animated-icon";
import { buttonVariants } from "@/components/button";
import { GitHubMark } from "@/components/icons/github-mark";
import { PageTemplate } from "@/components/page-template";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
	title: "Pricing"
};

const GITHUB_REPO_URL = "https://github.com/sloikodavid/composery";

type Feature = { icon: LucideIcon; text: string };

const MANAGED_FEATURES: Feature[] = [
	{ icon: RocketIcon, text: "Ready in a minute" },
	{ icon: ShieldCheckIcon, text: "Securely managed in Europe" },
	{ icon: SmartphoneIcon, text: "Reachable from any phone or browser" },
	{ icon: HistoryIcon, text: "Snapshot anytime" }
];

const SELF_HOSTED_FEATURES: Feature[] = [
	{ icon: ServerIcon, text: "Docker image, runs anywhere just like n8n" },
	{ icon: InfinityIcon, text: "Fully open-source, no lock-in" },
	{ icon: UsersIcon, text: "Platform-specific templates on GitHub" },
	{ icon: Angry, text: "You might get a headache" }
];

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
	name,
	descriptor,
	price,
	period,
	cta,
	features
}: {
	name: string;
	descriptor: string;
	price: string;
	period?: string;
	cta: ReactNode;
	features: Feature[];
}) {
	return (
		<div className="flex flex-col rounded-lg border border-border p-7 sm:p-8">
			<h3 className="font-heading text-2xl font-semibold tracking-tight text-foreground">
				{name}
			</h3>
			<p className="mt-1 text-sm text-muted-foreground">{descriptor}</p>

			<div className="mt-6 flex items-baseline gap-1.5">
				<span className="font-heading text-5xl font-semibold tracking-tight text-foreground">
					{price}
				</span>
				{period ? (
					<span className="text-sm text-muted-foreground">{period}</span>
				) : null}
			</div>

			<div className="mt-6">{cta}</div>

			<div className="mt-7 border-t border-border pt-7">
				<FeatureList features={features} />
			</div>
		</div>
	);
}

export default function PricingPage() {
	return (
		<PageTemplate breadcrumbs={[{ icon: WalletIcon, label: "Pricing" }]}>
			<div className="space-y-8">
				<div className="max-w-xl space-y-3">
					<h2 className="font-heading text-3xl font-semibold tracking-tight text-balance text-foreground">
						Two ways to run a Composery.
					</h2>
					<p className="text-base leading-7 text-muted-foreground">
						Whatever you pick, the editor is the same either way.
					</p>
				</div>

				<div className="grid gap-5 md:grid-cols-2">
					<PlanCard
						cta={
							<AnimatedIconLink
								className={cn("w-full", buttonVariants({ size: "lg" }))}
								href="/boxes/new"
								icon="plus"
								iconPosition="start"
								prefetch={false}
							>
								New box
							</AnimatedIconLink>
						}
						descriptor="Just pay, then open your cloud box."
						features={MANAGED_FEATURES}
						name="Composery Cloud"
						period="/ month"
						price="$20"
					/>

					<PlanCard
						cta={
							<a
								className={cn(
									"w-full gap-2",
									buttonVariants({ size: "lg", variant: "outline" })
								)}
								href={GITHUB_REPO_URL}
								rel="noreferrer"
								target="_blank"
							>
								<GitHubMark className="size-4" />
								Go to repo
							</a>
						}
						descriptor="Run the whole stack yourself."
						features={SELF_HOSTED_FEATURES}
						name="Self-hosted"
						price="Free"
					/>
				</div>
			</div>
		</PageTemplate>
	);
}
