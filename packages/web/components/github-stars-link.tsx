"use client";

import { Star } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/button";
import { GitHubMark } from "@/components/icons/github-mark";
import { cn } from "@/lib/utils";

export const GITHUB_REPO_URL = "https://github.com/sloikodavid/composery";
const GITHUB_REPO_API_URL =
	"https://api.github.com/repos/sloikodavid/composery";
const STAR_FORMATTER = new Intl.NumberFormat("en", {
	maximumFractionDigits: 1,
	notation: "compact"
});

export function GitHubStarsLink() {
	const [stars, setStars] = useState<number | null>(null);

	useEffect(() => {
		let ignore = false;

		async function loadStars() {
			try {
				const response = await fetch(GITHUB_REPO_API_URL);
				if (!response.ok) return;

				const repo = (await response.json()) as {
					stargazers_count?: number;
				};

				if (!ignore && typeof repo.stargazers_count === "number") {
					setStars(repo.stargazers_count);
				}
			} catch {}
		}

		void loadStars();

		return () => {
			ignore = true;
		};
	}, []);

	return (
		<motion.a
			aria-label="Star Composery on GitHub"
			// Starts as a circular icon-only button, then springs open to reveal the
			// star count once GitHub's API answers, so it never shifts mid-load.
			className={cn(
				buttonVariants({ variant: "outline" }),
				"hidden rounded-full sm:inline-flex",
				stars === null ? "w-8 px-0" : "gap-1.5 px-2"
			)}
			href={GITHUB_REPO_URL}
			// Animate only the width spring-open, not position. The header persists
			// across navigation, so plain `layout` would fly the button across the
			// page when the scroll position resets between routes.
			layout="size"
			rel="noreferrer"
			target="_blank"
			transition={{ type: "spring", bounce: 0.45, duration: 0.6 }}
		>
			<GitHubMark className="size-4" />
			<AnimatePresence>
				{stars !== null && (
					<motion.span
						animate={{ opacity: 1, scale: 1 }}
						className="flex items-center gap-1 text-xs font-medium tabular-nums"
						initial={{ opacity: 0, scale: 0.5 }}
						transition={{
							type: "spring",
							bounce: 0.5,
							delay: 0.05,
							duration: 0.5
						}}
					>
						<Star className="size-3.5 fill-amber-400 text-amber-400" />
						{STAR_FORMATTER.format(stars)}
					</motion.span>
				)}
			</AnimatePresence>
		</motion.a>
	);
}
