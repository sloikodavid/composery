import Link from "next/link";
import {
	HistoryIcon,
	PowerIcon,
	SmartphoneIcon,
	TerminalIcon,
	WorkflowIcon
} from "lucide-react";
import { AnimatedIconLink } from "@/components/animated-icon";
import { AgentStack } from "@/components/box/agent-stack";
import { buttonVariants } from "@/components/base/button";
import { GitHubLogo } from "@/components/icons/github-logo";
import { ThemedShot } from "./_components/themed-shot";
import { GITHUB_REPO_URL } from "@/convex/model/links";
import {
	APP_DESCRIPTION,
	APP_TAGLINE,
	BRAND_NAME,
	WEBSITE_ORIGIN
} from "shared";

const jsonLd = {
	"@context": "https://schema.org",
	"@graph": [
		{
			"@type": "Organization",
			name: BRAND_NAME,
			url: WEBSITE_ORIGIN,
			logo: `${WEBSITE_ORIGIN}/icon.svg`,
			sameAs: [GITHUB_REPO_URL]
		},
		{
			"@type": "WebSite",
			name: BRAND_NAME,
			url: WEBSITE_ORIGIN
		},
		{
			"@type": "SoftwareApplication",
			name: BRAND_NAME,
			url: WEBSITE_ORIGIN,
			description: APP_DESCRIPTION,
			applicationCategory: "DeveloperApplication",
			operatingSystem: "Web, Android, iOS, Linux"
		}
	]
};

const FEATURES = [
	{
		icon: PowerIcon,
		title: "It's always on",
		body: "Agents keep working with your laptop closed. Pick up where you left off, from any device."
	},
	{
		icon: AgentStack,
		title: "It's built for AI agents",
		body: "Copy + paste a setup prompt to remotely connect Claude Code or ChatGPT to your Composery."
	},
	{
		icon: WorkflowIcon,
		title: "Automations are easier to make",
		body: "Prompt-to-code instead of dragging nodes. It runs right where you build it, so there is nothing to deploy."
	},
	{
		icon: SmartphoneIcon,
		title: "You can use it from your phone",
		body: "The editor is patched to support mobile. Add a few Composeries to the home screen and use them like apps."
	},
	{
		icon: TerminalIcon,
		title: "It's basically a VPS without the trouble",
		body: "You get a hardened server from the get-go, and don't have to spend hours figuring out Tailscale and SSH."
	},
	{
		icon: HistoryIcon,
		title: "And you can just worry less",
		body: "Code doesn't run on your machine, and every box gets snapshots. Roll back in a click if something goes wrong."
	},
	{
		icon: GitHubLogo,
		title: "Oh also, it's open-source",
		body: (
			<>
				Composery runs anywhere that Docker does (like n8n). Guides and hosting
				templates for different platforms are in the docs{" "}
				<Link
					aria-label="Self-hosting docs"
					className="link"
					href="/docs/self-hosting"
				>
					here
				</Link>
				, and the repo is{" "}
				<a
					aria-label="GitHub repo"
					className="link"
					href={GITHUB_REPO_URL}
					rel="noreferrer"
					target="_blank"
				>
					here
				</a>
				.
			</>
		)
	}
];

const STEPS = [
	{
		title: "Get a Composery",
		body: "A box in Composery Cloud, or a self-hosted instance where you'd want it."
	},
	{
		title: "Run something",
		body: "Send a long-running command, task an agent."
	},
	{
		title: "Literally just walk away",
		body: "It will keep working right there in the cloud, so feel free to grab a snack and check in from wherever."
	}
];

export default function Home() {
	return (
		<div className="page-fade-in py-12 sm:py-16">
			<section className="mx-auto w-full max-w-[44rem] space-y-6 text-center">
				<div className="space-y-4">
					<h1 className="font-heading mx-auto text-[clamp(1.75rem,7.5vw,2.75rem)] leading-[1.1] font-medium tracking-tight text-foreground sm:text-nowrap md:text-5xl">
						Like VS Code, but always on.
					</h1>
					<p className="mx-auto max-w-[41rem] text-[clamp(0.875rem,3vw,1rem)] leading-[1.6] text-muted-foreground md:max-w-none md:text-lg md:text-nowrap">
						{APP_TAGLINE}
					</p>
				</div>
				<div className="flex flex-wrap justify-center gap-3">
					<AnimatedIconLink
						className={buttonVariants({ size: "lg" })}
						href="/pricing"
						icon="plus"
						iconPosition="start"
						prefetch={false}
					>
						New box
					</AnimatedIconLink>
					<Link
						className={buttonVariants({ size: "lg", variant: "secondary" })}
						href="/docs"
					>
						Read the docs
					</Link>
				</div>
			</section>

			<figure className="mx-auto mt-8 w-full max-w-6xl sm:mt-10">
				<ThemedShot
					alt="Claude Code working inside Composery: a morning brief open in the editor while the agent writes a new automation in the terminal."
					base="composery-ide"
					className="h-auto w-full"
					height={1855}
					priority
					sizes="(max-width: 1024px) 100vw, 1024px"
					width={2600}
				/>
			</figure>

			<section className="mx-auto mt-16 w-full max-w-5xl sm:mt-24">
				<div className="space-y-3 text-center">
					<h2 className="font-heading text-[clamp(1.25rem,5vw,1.875rem)] leading-[1.15] font-medium tracking-tight text-foreground">
						Why is it cool?
					</h2>
					<p className="mx-auto max-w-[36rem] text-[clamp(0.875rem,2.7vw,1rem)] leading-relaxed text-muted-foreground">
						Composery is made for productive people, so here&apos;s the 80/20
						explanation:
					</p>
				</div>
				<div className="mx-auto mt-10 max-w-3xl">
					{FEATURES.map(({ icon: Icon, title, body }) => (
						<div className="flex gap-4 py-5" key={title}>
							<span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted">
								<Icon className="size-4" />
							</span>
							<div className="space-y-1">
								<h3 className="font-heading text-base font-medium tracking-tight text-foreground">
									{title}
								</h3>
								<p className="text-sm leading-6 text-muted-foreground">
									{body}
								</p>
							</div>
						</div>
					))}
				</div>
			</section>

			<section className="mx-auto mt-16 w-full max-w-3xl text-center sm:mt-24">
				<h2 className="font-heading text-[clamp(1.25rem,5vw,1.875rem)] leading-[1.15] font-medium tracking-tight text-foreground">
					Phone support.
				</h2>
				<p className="mx-auto mt-3 max-w-[36rem] text-[clamp(0.875rem,2.7vw,1rem)] leading-relaxed text-muted-foreground">
					We patched all the gnarly bits in the editor to make it genuinely
					usable on mobile.
				</p>
				<ThemedShot
					alt="The same Composery instance on a phone: the welcome screen, Claude Code running in the terminal, and the morning brief."
					base="composery-mobile"
					className="mt-8 h-auto w-full"
					height={1435}
					sizes="(max-width: 768px) 100vw, 768px"
					width={2000}
				/>
			</section>

			<section className="mx-auto mt-16 w-full max-w-3xl sm:mt-24">
				<h2 className="font-heading text-center text-[clamp(1.25rem,5vw,1.875rem)] leading-[1.15] font-medium tracking-tight text-foreground">
					This will amaze you, when you try it:
				</h2>
				<ol className="mt-8 space-y-6">
					{STEPS.map(({ title, body }, index) => (
						<li className="flex gap-4" key={title}>
							<span
								aria-hidden="true"
								className="font-heading flex size-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-sm text-foreground"
							>
								{index + 1}
							</span>
							<div className="space-y-1">
								<h3 className="font-heading text-lg font-medium tracking-tight text-foreground">
									{title}
								</h3>
								<p className="text-sm leading-6 text-muted-foreground">
									{body}
								</p>
							</div>
						</li>
					))}
				</ol>
			</section>

			<section className="mx-auto mt-16 w-full max-w-3xl text-center sm:mt-24">
				<h2 className="font-heading text-[clamp(1.25rem,5vw,1.875rem)] leading-[1.15] font-medium tracking-tight text-foreground">
					Pro tip: Use separate boxes to isolate your work.
				</h2>
				<p className="mx-auto mt-3 max-w-[36rem] text-[clamp(0.875rem,2.7vw,1rem)] leading-relaxed text-muted-foreground">
					You can also sell a &quot;packing good stuff into people&apos;s
					boxes&quot; service, ez.
				</p>
				<div className="mt-6 flex flex-wrap justify-center gap-3">
					<AnimatedIconLink
						className={buttonVariants({ size: "lg" })}
						href="/pricing"
						icon="plus"
						iconPosition="start"
						prefetch={false}
					>
						New box
					</AnimatedIconLink>
					<Link
						className={buttonVariants({ size: "lg", variant: "secondary" })}
						href="/docs"
					>
						Read the docs
					</Link>
				</div>
			</section>

			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
			/>
		</div>
	);
}
