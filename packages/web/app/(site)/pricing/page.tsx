import type { Metadata } from "next";
import { CheckIcon, WalletIcon } from "lucide-react";
import { AnimatedIconLink } from "@/components/animated-icon";
import { buttonVariants } from "@/components/button";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle
} from "@/components/card";
import { GitHubMark } from "@/components/icons/github-mark";
import { PageTemplate } from "@/components/page-template";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
	title: "Pricing"
};

const CLOUD_FEATURES = [
	"Persistent cloud box with a VS Code-like interface",
	"Stateful workspace for long-running work",
	"Managed box creation, reset, and recovery",
	"Subscription billing with a customer portal"
];

const GITHUB_REPO_URL = "https://github.com/sloikodavid/composery";

export default function PricingPage() {
	return (
		<PageTemplate breadcrumbs={[{ icon: WalletIcon, label: "Pricing" }]}>
			<Card className="mx-auto max-w-md">
				<CardHeader className="gap-4">
					<CardTitle className="text-base">Box with Composery</CardTitle>
					<div className="flex items-baseline gap-1.5">
						<span className="font-heading text-4xl font-semibold tracking-tight text-foreground">
							$20
						</span>
						<span className="text-sm text-muted-foreground">/month</span>
					</div>
					<p className="text-sm leading-6 text-muted-foreground">
						Managed hosting for a persistent box, ready to run.
					</p>
				</CardHeader>

				<CardContent className="space-y-6">
					<AnimatedIconLink
						className={cn("w-full", buttonVariants({ size: "lg" }))}
						href="/boxes/new"
						icon="plus"
						iconPosition="start"
						prefetch={false}
					>
						New box
					</AnimatedIconLink>

					<ul className="grid gap-3 text-sm">
						{CLOUD_FEATURES.map((feature) => (
							<li className="flex gap-2.5" key={feature}>
								<CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
								<span className="text-muted-foreground">{feature}</span>
							</li>
						))}
					</ul>
				</CardContent>

				<CardFooter className="border-t">
					<p className="text-sm leading-6 text-muted-foreground">
						Prefer to own the stack? Composery is open source and free to{" "}
						<a
							className="inline-flex items-center gap-1.5 font-medium text-foreground link-underline"
							href={GITHUB_REPO_URL}
							rel="noreferrer"
							target="_blank"
						>
							<GitHubMark className="size-4" />
							self-host
						</a>
						.
					</p>
				</CardFooter>
			</Card>
		</PageTemplate>
	);
}
