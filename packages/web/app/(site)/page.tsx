import Image from "next/image";
import Link from "next/link";
import { AnimatedIconLink } from "@/components/animated-icon";
import { buttonVariants } from "@/components/button";

export default function Home() {
	return (
		<div className="space-y-10 sm:space-y-14">
			<section className="space-y-6 pt-6 sm:pt-10">
				<div className="space-y-4">
					<h1 className="font-heading text-4xl font-semibold tracking-tight text-balance text-foreground sm:text-5xl">
						Like VS Code, but always on.
					</h1>
					<p className="max-w-xl text-lg leading-8 text-muted-foreground">
						A secure cloud computer with a nice UI, usable from any phone or
						browser.
					</p>
				</div>
				<div className="flex gap-3">
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

			<Image
				alt="Composery editor workspace"
				className="block w-full rounded-xl border border-border dark:hidden"
				height={1079}
				priority
				src="/showcase-light.png"
				width={1919}
			/>
			<Image
				alt="Composery editor workspace"
				className="hidden w-full rounded-xl border border-border dark:block"
				height={1079}
				priority
				src="/showcase-dark.png"
				width={1919}
			/>
		</div>
	);
}
