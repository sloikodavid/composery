"use client";

import { useAction, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatedIconButton } from "@/components/animated-icon";
import { Input } from "@/components/input";
import { Label } from "@/components/label";
import { PageTemplate } from "@/components/page-template";
import { api } from "@/convex/_generated/api";
import { isValidSlug, sanitizeSlug } from "@/lib/box-slug";
import { errorMessage } from "@/lib/error-message";
import { cn } from "@/lib/utils";

export function NewBox() {
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
	const checkoutAvailability = useQuery(api.user.checkout.availability, {});
	const slugAvailable = availability?.available ?? false;
	const checkingSlug = slugLooksValid && availability == null;
	const slugTaken = slugLooksValid && availability != null && !slugAvailable;
	const canCheckout =
		slugLooksValid &&
		slugAvailable &&
		(checkoutAvailability?.available === true ||
			availability?.resumable === true);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!canCheckout || submitting) return;

		setSubmitting(true);
		try {
			const checkout = await createCheckout({
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
		<PageTemplate
			breadcrumbs={[
				{ href: "/boxes", icon: "washing-machine", label: "Boxes" },
				{ label: "New" }
			]}
		>
			<div className="grid min-h-[calc(100svh-13rem)] place-items-center py-10">
				<form className="w-full max-w-md space-y-2" onSubmit={handleSubmit}>
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
					{/* Always-rendered fixed-height slot so the centered form doesn't
					    re-center (shifting the fields above) when the message appears. */}
					<p
						aria-live="polite"
						className="min-h-8 text-center text-xs text-muted-foreground"
					>
						{checkoutAvailability?.available === false &&
						!availability?.resumable
							? checkoutAvailability.message
							: null}
					</p>
				</form>
			</div>
		</PageTemplate>
	);
}
