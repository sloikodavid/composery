import Link from "next/link";
import { AnimatedIconLink } from "@/components/animated-icon";
import { buttonVariants } from "@/components/button";

export default function Home() {
	return (
		<div className="flex min-h-[calc(100svh-9rem)] items-center justify-center py-10 sm:py-14">
			<section className="mx-auto w-full max-w-[44rem] space-y-6 text-center">
				<div className="space-y-4">
					<h1 className="font-heading mx-auto text-4xl font-medium tracking-tight text-balance text-foreground sm:text-5xl sm:text-nowrap">
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
						className={buttonVariants({ size: "lg", variant: "outline" })}
						href="/pricing"
					>
						See pricing
					</Link>
				</div>
			</section>
		</div>
	);
}
