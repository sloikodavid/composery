import type { CSSProperties } from "react";
import { Glow } from "@/components/brand/glow";
import { Wordmark, wordmarkMetrics } from "@/components/brand/wordmark";
import { Container } from "@/components/ui/container";
import { Link } from "@/components/ui/link";

const { ascent, descent, capHeight, descender, inkStart, inkWidth } =
	wordmarkMetrics;

// The ink fills the container width, and the line box is trimmed to the ink.
const wordmarkStyle: CSSProperties = {
	fontSize: `calc(100cqw / ${inkWidth})`,
	lineHeight: ascent + descent,
	marginBlock: `calc(${capHeight}em - ${ascent}em) calc(${descender}em - ${descent}em)`,
	marginInlineStart: `-${inkStart}em`,
};

export function Footer() {
	return (
		// The content is the background color, so it reads as cut out of the glow.
		// The brand selection color would disappear on the glow, so selection puts the
		// same cut-out content on a primary block instead.
		<footer className="relative text-background selection:bg-primary selection:text-primary-foreground">
			<Glow className="mask-t-from-60% absolute inset-x-0 bottom-0 -z-10 h-[calc(100%+18rem)]" />
			<Container className="flex flex-col gap-10 pt-40 pb-8">
				<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
					<nav aria-label="Legal">
						<ul className="flex gap-6">
							<li>
								<Link href="/privacy">Privacy</Link>
							</li>
							<li>
								<Link href="/terms">Terms</Link>
							</li>
						</ul>
					</nav>
					<p className="font-brand tracking-display">© Composery</p>
				</div>
				<Link href="/" className="@container block overflow-clip">
					<Wordmark className="block whitespace-nowrap" style={wordmarkStyle} />
				</Link>
			</Container>
		</footer>
	);
}
