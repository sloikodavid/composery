import Image from "next/image";
import Link from "next/link";
import { AnimatedIconLink } from "@/components/animated-icon";
import { buttonVariants } from "@/components/button";

export default function Home() {
	return (
		<div className="mx-auto max-w-2xl">
			<section className="space-y-6 py-8 sm:py-12">
				<div className="space-y-4">
					<h1 className="font-heading text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
						Like VS Code, always on in the cloud.
					</h1>
					<p className="max-w-xl text-base leading-7 text-muted-foreground">
						A persistent cloud box you can reach from any browser or phone, made
						for long-running AI agents.
					</p>
				</div>
				<div className="grid grid-cols-2 gap-3 sm:flex sm:flex-row">
					<AnimatedIconLink
						className={buttonVariants({ size: "lg" })}
						href="/boxes/new"
						icon="arrow-right"
						prefetch={false}
					>
						Get started
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
				alt="Code editor workspace preview"
				className="block w-full rounded-2xl"
				height={988}
				priority
				src="/showcase.png"
				width={1519}
			/>
		</div>
	);
}
