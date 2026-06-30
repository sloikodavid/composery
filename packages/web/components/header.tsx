"use client";

import { UserButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated } from "convex/react";
import { usePathname } from "next/navigation";
import { AnimatedIconLink } from "@/components/animated-icon";
import { buttonVariants } from "@/components/button";
import { FumadocsSidebar } from "@/components/fumadocs-sidebar";
import { GitHubStarsLink } from "@/components/github-stars-link";
import { Logo } from "@/components/logo";
import {
	type NavLink,
	PUBLIC_NAV_LINKS,
	useAuthedNavLinks
} from "@/components/nav-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { headerUserButtonAppearance } from "@/lib/clerk-appearance";
import { cn } from "@/lib/utils";

export function Header() {
	const pathname = usePathname();
	const authedLinks = useAuthedNavLinks();

	// `fade` eases the auth-only links in once auth resolves, so they don't pop.
	const pill = (link: NavLink, fade: boolean) => (
		<AnimatedIconLink
			className={cn(
				"flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
				pathname.startsWith(link.href)
					? "bg-primary/10 text-primary"
					: "text-muted-foreground hover:bg-muted dark:hover:bg-muted/50 hover:text-foreground",
				fade && "header-auth-fade-in"
			)}
			href={link.href}
			icon={link.icon}
			iconPosition="start"
			key={link.href}
		>
			{link.label}
		</AnimatedIconLink>
	);

	return (
		<header className="sticky top-0 z-40">
			{/* Desktop: the floating pill. */}
			<div className="mx-auto hidden h-14 w-full max-w-5xl items-center justify-between gap-6 rounded-b-2xl border border-t-0 border-border bg-background px-3.5 md:flex">
				<div className="flex min-w-0 items-center gap-5">
					<Logo />
					<nav className="flex items-center gap-1">
						{PUBLIC_NAV_LINKS.map((link) => pill(link, false))}
						<Authenticated>
							{authedLinks.map((link) => pill(link, true))}
						</Authenticated>
					</nav>
				</div>

				<div className="flex items-center gap-2">
					<GitHubStarsLink />
					<ThemeToggle />
					<Authenticated>
						{/* Fixed footprint so the row displaces once when auth resolves;
						    Clerk mounting inside it a beat later can't shift it again. */}
						<div className="header-auth-fade-in size-8">
							<UserButton appearance={headerUserButtonAppearance} />
						</div>
					</Authenticated>
					<Unauthenticated>
						<AnimatedIconLink
							className={cn("header-auth-fade-in", buttonVariants())}
							href="/sign-in"
							icon="login"
							iconPosition="start"
						>
							Sign in
						</AnimatedIconLink>
					</Unauthenticated>
				</div>
			</div>

			{/* Narrow screens: fumadocs' sidebar drawer, isolated in its own component. */}
			<FumadocsSidebar />
		</header>
	);
}
