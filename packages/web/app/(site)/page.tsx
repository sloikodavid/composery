import Link from "next/link";
import { AnimatedIconLink } from "@/components/animated-icon";
import { buttonVariants } from "@/components/base/button";
import { ThemedShot } from "./_components/themed-shot";
import { GITHUB_REPO_URL } from "@/lib/links";
import { appDescription, appName, appTagline, siteUrl } from "@/lib/shared";

const jsonLd = {
	"@context": "https://schema.org",
	"@graph": [
		{
			"@type": "Organization",
			name: appName,
			url: siteUrl,
			logo: `${siteUrl}/icon.svg`,
			sameAs: [GITHUB_REPO_URL]
		},
		{
			"@type": "WebSite",
			name: appName,
			url: siteUrl
		},
		{
			"@type": "SoftwareApplication",
			name: appName,
			url: siteUrl,
			description: appDescription,
			applicationCategory: "DeveloperApplication",
			operatingSystem: "Web, Android, iOS, Linux"
		}
	]
};

export default function Home() {
	return (
		<div className="page-fade-in py-12 sm:py-16">
			<section className="mx-auto w-full max-w-[44rem] space-y-6 text-center">
				<div className="space-y-4">
					<h1 className="font-heading mx-auto text-[clamp(1.75rem,7.5vw,2.75rem)] leading-[1.1] font-medium tracking-tight text-foreground sm:text-nowrap md:text-5xl">
						Like VS Code, but always on.
					</h1>
					<p className="mx-auto max-w-[41rem] text-[clamp(0.875rem,3vw,1rem)] leading-[1.6] text-muted-foreground md:max-w-none md:text-lg md:text-nowrap">
						{appTagline}
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
						className={buttonVariants({ size: "lg", variant: "ghost" })}
						href="/pricing"
					>
						See pricing
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

			<section className="mx-auto mt-16 w-full max-w-3xl text-center sm:mt-24">
				<h2 className="font-heading text-[clamp(1.25rem,5vw,1.875rem)] leading-[1.15] font-medium tracking-tight text-foreground">
					Check on your agents from anywhere.
				</h2>
				<p className="mx-auto mt-3 max-w-[36rem] text-[clamp(0.875rem,2.7vw,1rem)] leading-relaxed text-muted-foreground">
					Your Composery keeps working with your laptop closed. Pick up from
					mobile whenever you want.
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

			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
			/>
		</div>
	);
}
