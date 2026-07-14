import Link from "next/link";
import { GitHubIcon } from "@/components/icons/github-icon";
import { Logo } from "@/components/logo";
import { GITHUB_REPO_URL } from "@/lib/links";
import { cn } from "@/lib/utils";

const PRODUCT_LINKS = [
	{ href: "/pricing", label: "Pricing" },
	{ href: "/docs", label: "Docs" }
];

const RESOURCE_LINKS = [
	{ href: "/docs/configuration", label: "Configuration" },
	{ href: "/docs/self-hosting", label: "Self-hosting" },
	{ href: "/brand", label: "Brand" }
];

const LEGAL_LINKS = [
	{ href: "/privacy", label: "Privacy" },
	{ href: "/terms", label: "Terms" },
	{ href: "/cookies", label: "Cookies" },
	{ href: "/licenses", label: "Licences" }
];

export function Footer() {
	return (
		<footer className="border-t border-border bg-background">
			<div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-10 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto] md:gap-16">
				<div className="max-w-sm space-y-3">
					<Logo />
					<p className="text-balance text-sm leading-6 text-muted-foreground">
						A secure cloud computer with a powerful UI, usable from any phone or
						browser.
					</p>
				</div>

				<div className="grid gap-8 sm:grid-cols-3 sm:gap-14 md:justify-self-end md:gap-16">
					<FooterLinkGroup
						className="md:text-right"
						links={PRODUCT_LINKS}
						title="Product"
					/>
					<FooterLinkGroup
						className="md:text-right"
						links={RESOURCE_LINKS}
						title="Resources"
					/>
					<FooterLinkGroup
						className="md:text-right"
						links={LEGAL_LINKS}
						title="Legal"
					/>
				</div>

				<div className="flex flex-col items-start gap-4 border-t border-border pt-6 text-sm text-muted-foreground md:col-span-2 md:flex-row md:items-center md:justify-between">
					<p>&copy; {new Date().getFullYear()} Composery</p>
					<a
						className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
						href={GITHUB_REPO_URL}
						rel="noreferrer"
						target="_blank"
					>
						<GitHubIcon className="size-4" />
						GitHub
					</a>
				</div>
			</div>
		</footer>
	);
}

function FooterLinkGroup({
	className,
	links,
	title
}: {
	className?: string;
	links: Array<{ href: string; label: string }>;
	title: string;
}) {
	return (
		<nav className={cn("space-y-3", className)} aria-label={title}>
			<p className="text-sm font-medium text-foreground">{title}</p>
			<ul className="space-y-2">
				{links.map((link) => (
					<li key={link.href}>
						<Link
							className="text-sm text-muted-foreground transition-colors hover:text-foreground"
							href={link.href}
						>
							{link.label}
						</Link>
					</li>
				))}
			</ul>
		</nav>
	);
}
