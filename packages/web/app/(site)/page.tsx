import Link from "next/link";
import { AnimatedIconLink } from "@/components/animated-icon";
import { buttonVariants } from "@/components/button";
import { ThemedShot } from "@/components/themed-shot";
import { GITHUB_REPO_URL } from "@/lib/links";
import { appDescription, appName, siteUrl } from "@/lib/shared";

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
		<div className="py-12 sm:py-16">
			<section className="mx-auto w-full max-w-[44rem] space-y-6 text-center">
				<div className="space-y-4">
					<h1 className="font-heading mx-auto text-4xl font-medium tracking-tight text-foreground sm:text-5xl sm:text-nowrap">
						Like VS Code, but always on.
					</h1>
					<p className="mx-auto max-w-[41rem] text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8 sm:text-nowrap">
						A secure cloud computer with a powerful UI, usable from any phone or
						browser.
					</p>
				</div>
				<div className="flex flex-wrap justify-center gap-3">
					<AnimatedIconLink
						className={buttonVariants({ size: "lg" })}
						href="/boxes/new"
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

			<figure className="mx-auto mt-8 w-full max-w-5xl sm:mt-10">
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
				<h2 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-3xl">
					Check on your agents from anywhere.
				</h2>
				<p className="mx-auto mt-3 max-w-[36rem] text-muted-foreground">
					Your agents keep working with your laptop closed. Open a phone to see
					what they did, and tell them what is next.
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
