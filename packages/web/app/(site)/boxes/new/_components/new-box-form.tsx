"use client";

import { useAction, useQuery } from "convex/react";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatedIconButton } from "@/components/animated-icon";
import { Button } from "@/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle
} from "@/components/card";
import { Input } from "@/components/input";
import { Label } from "@/components/label";
import { api } from "@/convex/_generated/api";
import { isValidSlug, sanitizeSlug } from "@/lib/box-slug";
import { errorMessage } from "@/lib/error-message";

export function NewBoxForm() {
	const createCheckout = useAction(api.user.checkout.createCheckout);
	const [slug, setSlug] = useState("");
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const [frame, setFrame] = useState<"slug" | "password">("slug");
	const [submitting, setSubmitting] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);
	const normalizedSlug = sanitizeSlug(slug);
	const slugLooksValid = isValidSlug(normalizedSlug);
	const availability = useQuery(
		api.user.checkout.slugAvailability,
		slugLooksValid ? { slug: normalizedSlug } : "skip"
	);
	const slugAvailable = availability?.available ?? false;
	const canContinueSlug = slugLooksValid && slugAvailable;
	const slugTaken = slugLooksValid && availability != null && !slugAvailable;
	const canCheckout =
		password.length > 0 && confirmation.length > 0 && password === confirmation;
	const passwordsMismatch =
		confirmation.length > 0 && password !== confirmation;

	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (frame === "slug") {
			if (!canContinueSlug) return;
			setFrame("password");
			return;
		}

		if (!canCheckout || submitting) return;

		setSubmitting(true);
		try {
			const checkout = await createCheckout({
				slug: normalizedSlug,
				password
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
		<div className="mx-auto w-full max-w-md">
			<Card>
				<CardHeader>
					<CardTitle>
						{frame === "slug" ? "Name your box" : "Set a password"}
					</CardTitle>
					<CardDescription>
						{frame === "slug"
							? "Pick a name for your box. Lowercase letters, numbers and dashes."
							: "You'll use this password to access your box."}
					</CardDescription>
				</CardHeader>

				<CardContent>
					<form onSubmit={handleSubmit}>
						{frame === "slug" ? (
							<div className="space-y-2.5">
								<div className="flex flex-col gap-2.5 sm:flex-row">
									<Input
										aria-invalid={slugTaken}
										autoCapitalize="none"
										autoComplete="off"
										className="h-11 min-w-0 flex-1 px-4 text-base font-medium"
										id="box-slug"
										maxLength={63}
										name="slug"
										onChange={(event) =>
											setSlug(sanitizeSlug(event.target.value))
										}
										pattern="[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?"
										placeholder="my-box"
										ref={inputRef}
										spellCheck={false}
										type="text"
										value={slug}
									/>

									<AnimatedIconButton
										className="h-11 w-full sm:w-auto"
										disabled={!canContinueSlug}
										icon="arrow-right"
										size="lg"
										type="submit"
									>
										Continue
									</AnimatedIconButton>
								</div>

								{slugTaken ? (
									<p
										aria-live="polite"
										className="inline-flex items-center gap-1.5 text-sm text-destructive"
									>
										<TriangleAlertIcon className="size-4" />
										That name is taken.
									</p>
								) : canContinueSlug ? (
									<p
										aria-live="polite"
										className="inline-flex items-center gap-1.5 text-sm text-success"
									>
										<CheckIcon className="size-4" />
										Available.
									</p>
								) : null}
							</div>
						) : (
							<div className="space-y-4">
								<div className="space-y-1.5">
									<Label htmlFor="box-password">Box password</Label>
									<Input
										autoComplete="new-password"
										className="h-11"
										id="box-password"
										name="password"
										onChange={(event) => setPassword(event.target.value)}
										type="password"
										value={password}
									/>
								</div>
								<div className="space-y-1.5">
									<Label htmlFor="box-password-confirm">Confirm password</Label>
									<Input
										aria-invalid={passwordsMismatch}
										autoComplete="new-password"
										className="h-11"
										id="box-password-confirm"
										name="confirmation"
										onChange={(event) => setConfirmation(event.target.value)}
										type="password"
										value={confirmation}
									/>
									{passwordsMismatch ? (
										<p className="inline-flex items-center gap-1.5 text-sm text-destructive">
											<TriangleAlertIcon className="size-4" />
											Passwords do not match.
										</p>
									) : null}
								</div>

								<div className="flex items-center justify-between border-t border-border pt-4 text-sm">
									<span className="text-muted-foreground">
										{normalizedSlug || "Box"}
									</span>
									<span className="font-medium text-foreground">
										$20 / month
									</span>
								</div>

								<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
									<Button
										disabled={submitting}
										onClick={() => setFrame("slug")}
										type="button"
										variant="outline"
									>
										Back
									</Button>
									<AnimatedIconButton
										className="w-full sm:w-auto"
										disabled={!canCheckout || submitting}
										icon="arrow-right"
										type="submit"
									>
										Continue to checkout
									</AnimatedIconButton>
								</div>
							</div>
						)}
					</form>
				</CardContent>
			</Card>
		</div>
	);
}
