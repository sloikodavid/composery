import { Glow } from "@/components/brand/glow";
import { Logo } from "@/components/brand/logo";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { Link } from "@/components/ui/link";

export function Footer() {
	return (
		<footer className="relative">
			<Glow className="absolute inset-x-0 bottom-0 -z-10 h-[calc(100%+18rem)]" />
			<Container className="pt-40 pb-10">
				<Card className="flex flex-col gap-10">
					<Logo className="self-start text-xl" />
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
				</Card>
			</Container>
		</footer>
	);
}
