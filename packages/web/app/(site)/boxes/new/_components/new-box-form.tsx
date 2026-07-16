"use client";

import { useAction, useQuery } from "convex/react";
import { WashingMachineIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatedIconButton } from "@/components/animated-icon";
import { Input } from "@/components/input";
import { Label } from "@/components/label";
import { api } from "@/convex/_generated/api";
import { isValidSlug, sanitizeSlug } from "@/lib/box-slug";
import { errorMessage } from "@/lib/error-message";
import { cn } from "@/lib/utils";

export function NewBoxForm() {
	const createCheckout = useAction(api.user.checkout.createCheckout);
	const [slug, setSlug] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const slugInputRef = useRef<HTMLInputElement>(null);
	const normalizedSlug = sanitizeSlug(slug);
	const slugLooksValid = isValidSlug(normalizedSlug);
	const availability = useQuery(
		api.user.checkout.slugAvailability,
		slugLooksValid ? { slug: normalizedSlug } : "skip"
	);
	const slugAvailable = availability?.available ?? false;
	const checkingSlug = slugLooksValid && availability == null;
	const slugTaken = slugLooksValid && availability != null && !slugAvailable;
	const canCheckout = slugLooksValid && slugAvailable;

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canCheckout || submitting) return;

		setSubmitting(true);
		try {
			// Consent is bound to the submit button: the caption directly below
			// it states the terms agreement and the express request for
			// immediate performance, so continuing is the express act.
			const checkout = await createCheckout({
				legalAccepted: true,
				slug: normalizedSlug
			});
			window.location.assign(checkout.checkoutUrl);
		} catch (error) {
			toast.error("Checkout could not start", {
				description: errorMessage(error)
			});
			setSubmitting(false);
		}
	}

	return (
		<div className="mx-auto max-w-4xl space-y-4">
			<nav className="flex min-h-8 flex-wrap items-center gap-1.5 text-lg font-medium text-foreground">
				<Link
					className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
					href="/boxes"
				>
					<WashingMachineIcon className="size-5" />
					Boxes
				</Link>
				<span aria-hidden className="text-muted-foreground">
					/
				</span>
				<span>New</span>
			</nav>

			<div className="grid min-h-[calc(100svh-13rem)] place-items-center py-10">
				<form className="w-full max-w-md space-y-4" onSubmit={handleSubmit}>
					<div className="space-y-2">
						<div className="flex items-end justify-between gap-3">
							<Label className="text-[15px]" htmlFor="box-slug">
								Slug
							</Label>
							<span
								aria-live="polite"
								className={cn(
									"text-xs font-medium",
									slugTaken
										? "text-destructive"
										: slugAvailable
											? "text-success"
											: "text-muted-foreground"
								)}
							>
								{slugTaken
									? "Taken"
									: slugAvailable
										? "Available"
										: checkingSlug
											? "Checking"
											: ""}
							</span>
						</div>
						<Input
							aria-invalid={slugTaken}
							autoCapitalize="none"
							autoComplete="off"
							className="h-12 rounded-lg px-5 text-[15px]"
							id="box-slug"
							maxLength={63}
							name="slug"
							onChange={(event) => setSlug(sanitizeSlug(event.target.value))}
							pattern="[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?"
							placeholder="my-box"
							ref={slugInputRef}
							spellCheck={false}
							type="text"
							value={slug}
						/>
					</div>

					<AnimatedIconButton
						className="h-12 w-full rounded-lg text-[15px]"
						disabled={!canCheckout || submitting}
						icon="arrow-right"
						size="lg"
						type="submit"
					>
						Continue to checkout
					</AnimatedIconButton>

					<p className="text-xs leading-5 text-muted-foreground">
						By continuing, you agree to the{" "}
						<Link className="link" href="/terms" target="_blank">
							Terms of Service
						</Link>{" "}
						and request that this recurring subscription start immediately; if
						you withdraw within 14 days you may owe a proportionate amount for
						service supplied.
					</p>
				</form>
			</div>
		</div>
	);
}
