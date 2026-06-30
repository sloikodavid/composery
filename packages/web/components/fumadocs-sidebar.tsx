"use client";

import { UserButton } from "@clerk/nextjs";
import { Authenticated, Unauthenticated } from "convex/react";
import { NextProvider } from "fumadocs-core/framework/next";
import {
	SidebarDrawerContent,
	SidebarDrawerOverlay,
	SidebarProvider,
	SidebarTrigger
} from "fumadocs-ui/components/sidebar/base";
import { buttonVariants as fdButtonVariants } from "fumadocs-ui/components/ui/button";
import { SidebarIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatedIconLink } from "@/components/animated-icon";
import { buttonVariants } from "@/components/button";
import { FumadocsThemeToggle } from "@/components/fumadocs-theme-toggle";
import { GITHUB_REPO_URL } from "@/components/github-stars-link";
import { GitHubMark } from "@/components/icons/github-mark";
import { Logo } from "@/components/logo";
import {
	type NavLink,
	PUBLIC_NAV_LINKS,
	useAuthedNavLinks
} from "@/components/nav-links";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { cn } from "@/lib/utils";

// fumadocs' real ghost icon button (its buttonVariants), exactly as the docs use
// it for the sidebar toggle, the drawer close, and the GitHub link.
const FUMADOCS_GHOST_ICON = fdButtonVariants({
	color: "ghost",
	size: "icon-sm",
	className: "p-2"
});

// fumadocs' real sidebar drawer, shown on narrow screens. SidebarProvider owns
// the open state, the responsive drawer/full switch (collapses on resize to
// desktop), and close-on-navigation; SidebarDrawerContent supplies the exact
// slide/fade. NextProvider wires the framework hooks it needs. All fumadocs is
// confined to this file so the rest of the app stays free of it.
export function FumadocsSidebar() {
	const pathname = usePathname();
	const authedLinks = useAuthedNavLinks();

	// Plain icon-less rows that mirror the docs sidebar (the bar's animated icons
	// would behave differently here, and the docs sidebar has no icons).
	const row = (link: NavLink) => (
		<Link
			className={cn(
				"flex items-center gap-2 rounded-lg p-2 text-[0.9375rem] transition-colors",
				pathname.startsWith(link.href)
					? "bg-primary/10 text-primary"
					: "text-muted-foreground hover:bg-accent dark:hover:bg-accent/50 hover:text-accent-foreground"
			)}
			href={link.href}
			key={link.href}
		>
			{link.label}
		</Link>
	);

	return (
		<NextProvider>
			<SidebarProvider>
				<div className="flex h-14 items-center border-b border-border bg-background/80 pe-2.5 ps-4 backdrop-blur-sm md:hidden">
					<Logo />
					<div className="flex-1" />
					<SidebarTrigger
						aria-label="Open menu"
						className={FUMADOCS_GHOST_ICON}
					>
						<SidebarIcon />
					</SidebarTrigger>
				</div>

				<SidebarDrawerOverlay className="fixed inset-0 z-40 backdrop-blur-xs data-[state=open]:animate-fd-fade-in data-[state=closed]:animate-fd-fade-out" />
				<SidebarDrawerContent className="fixed inset-y-0 end-0 z-40 flex w-[85%] max-w-[380px] flex-col border-s bg-fd-background text-[0.9375rem] shadow-lg data-[state=open]:animate-fd-sidebar-in data-[state=closed]:animate-fd-sidebar-out">
					<div className="flex items-center gap-1.5 p-4 pb-2 text-muted-foreground">
						<div className="flex flex-1">
							<a
								aria-label="Composery on GitHub"
								className={FUMADOCS_GHOST_ICON}
								href={GITHUB_REPO_URL}
								rel="noreferrer"
								target="_blank"
							>
								<GitHubMark />
							</a>
						</div>
						<FumadocsThemeToggle className="p-0" />
						<SidebarTrigger
							aria-label="Close menu"
							className={FUMADOCS_GHOST_ICON}
						>
							<SidebarIcon />
						</SidebarTrigger>
					</div>

					<nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-4">
						{PUBLIC_NAV_LINKS.map(row)}
						<Authenticated>{authedLinks.map(row)}</Authenticated>
					</nav>

					<div className="flex flex-col items-start p-4">
						<Authenticated>
							<UserButton appearance={clerkAppearance} />
						</Authenticated>
						<Unauthenticated>
							<AnimatedIconLink
								className={buttonVariants({ className: "w-full" })}
								href="/sign-in"
								icon="login"
								iconPosition="start"
							>
								Sign in
							</AnimatedIconLink>
						</Unauthenticated>
					</div>
				</SidebarDrawerContent>
			</SidebarProvider>
		</NextProvider>
	);
}
