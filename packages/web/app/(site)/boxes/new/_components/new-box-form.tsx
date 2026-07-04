"use client";

import { useAction, useQuery } from "convex/react";
import { WashingMachineIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatedIconButton } from "@/components/animated-icon";
import { Input } from "@/components/input";
import { Label } from "@/components/label";
import { api } from "@/convex/_generated/api";
import {
	checkBoxPasswordStrength,
	checkPwnedBoxPassword
} from "@/lib/box-password-check";
import { isValidSlug, sanitizeSlug } from "@/lib/box-slug";
import { errorMessage } from "@/lib/error-message";
import { cn } from "@/lib/utils";

type Step = "slug" | "password" | "confirm";

type PasswordBreachCheck = {
	count?: number;
	password: string;
	status: "idle" | "checking" | "clear" | "found" | "unavailable";
};

const stepCrumbs: { key: Exclude<Step, "slug">; label: string }[] = [
	{ key: "password", label: "Password" },
	{ key: "confirm", label: "Confirm password" }
];

export function NewBoxForm() {
	const createCheckout = useAction(api.user.checkout.createCheckout);
	const [slug, setSlug] = useState("");
	const [password, setPassword] = useState("");
	const [confirmation, setConfirmation] = useState("");
	const [step, setStep] = useState<Step>("slug");
	const [submitting, setSubmitting] = useState(false);
	const slugInputRef = useRef<HTMLInputElement>(null);
	const passwordInputRef = useRef<HTMLInputElement>(null);
	const confirmationInputRef = useRef<HTMLInputElement>(null);
	const passwordBreachAbortRef = useRef<AbortController | null>(null);
	const [breachCheck, setBreachCheck] = useState<PasswordBreachCheck>({
		password: "",
		status: "idle"
	});
	const normalizedSlug = sanitizeSlug(slug);
	const slugLooksValid = isValidSlug(normalizedSlug);
	const availability = useQuery(
		api.user.checkout.slugAvailability,
		slugLooksValid ? { slug: normalizedSlug } : "skip"
	);
	const slugAvailable = availability?.available ?? false;
	const checkingSlug = slugLooksValid && availability == null;
	const canContinueSlug = slugLooksValid && slugAvailable;
	const slugTaken = slugLooksValid && availability != null && !slugAvailable;
	const visibleStepCrumbs =
		step === "confirm"
			? stepCrumbs
			: step === "password"
				? [stepCrumbs[0]]
				: [];
	const passwordStrength = checkBoxPasswordStrength(password);
	const currentBreachCheck =
		breachCheck.password === password
			? breachCheck
			: ({ password, status: "idle" } satisfies PasswordBreachCheck);
	const checkingPasswordBreach = currentBreachCheck.status === "checking";
	const passwordFoundInBreach = currentBreachCheck.status === "found";
	// Breach check runs on submit, not while typing, so strength alone gates the
	// button. A breach hit blocks inside handleSubmit instead of disabling here.
	const canContinuePassword = passwordStrength.ok;
	const canCheckout = canContinuePassword && confirmation === password;
	const passwordsMismatch =
		confirmation.length > 0 && password !== confirmation;

	useEffect(() => {
		return () => passwordBreachAbortRef.current?.abort();
	}, []);

	useEffect(() => {
		if (step === "slug") {
			slugInputRef.current?.focus();
			slugInputRef.current?.select();
			return;
		}

		if (step === "password") {
			passwordInputRef.current?.focus();
			return;
		}

		confirmationInputRef.current?.focus();
	}, [step]);

	function canOpenStep(target: Step) {
		if (target === "slug") return true;
		if (target === "password") return canContinueSlug;
		return canContinueSlug && canContinuePassword;
	}

	function openStep(target: Step) {
		if (canOpenStep(target)) setStep(target);
	}

	function handlePasswordChange(value: string) {
		passwordBreachAbortRef.current?.abort();
		setPassword(value);
	}

	async function runPasswordBreachCheck(value = password) {
		const strength = checkBoxPasswordStrength(value);
		if (!strength.ok) return false;

		if (currentBreachCheck.password === value) {
			if (currentBreachCheck.status === "clear") return true;
			if (currentBreachCheck.status === "unavailable") return true;
			if (currentBreachCheck.status === "found") {
				toast.error("Choose a different password", {
					description: "That password appears in known breach data."
				});
				return false;
			}
		}

		passwordBreachAbortRef.current?.abort();
		const controller = new AbortController();
		passwordBreachAbortRef.current = controller;
		setBreachCheck({ password: value, status: "checking" });

		try {
			const count = await checkPwnedBoxPassword(value, controller.signal);
			if (controller.signal.aborted) return false;

			const status = count > 0 ? "found" : "clear";
			setBreachCheck({ count, password: value, status });

			if (count > 0) {
				toast.error("Choose a different password", {
					description: "That password appears in known breach data."
				});
			}

			return count === 0;
		} catch {
			if (controller.signal.aborted) return false;

			setBreachCheck({ password: value, status: "unavailable" });
			toast.warning("Breach check unavailable", {
				description: "You can continue, but the password was not checked."
			});
			return true;
		}
	}

	async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();

		if (step === "slug") {
			if (!canContinueSlug) return;
			setStep("password");
			return;
		}

		if (step === "password") {
			if (!passwordStrength.ok || checkingPasswordBreach) return;
			const passwordClear = await runPasswordBreachCheck();
			if (!passwordClear) return;
			setStep("confirm");
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
				<button
					aria-current={step === "slug" ? "step" : undefined}
					className={cn(
						"transition-colors",
						step === "slug"
							? "text-foreground"
							: "text-muted-foreground hover:text-foreground"
					)}
					onClick={() => setStep("slug")}
					type="button"
				>
					New
				</button>
				{visibleStepCrumbs.map(({ key, label }) => (
					<span className="contents" key={key}>
						<span aria-hidden className="text-muted-foreground">
							/
						</span>
						<button
							aria-current={step === key ? "step" : undefined}
							className={cn(
								"transition-colors",
								step === key
									? "text-foreground"
									: canOpenStep(key)
										? "text-muted-foreground hover:text-foreground"
										: "cursor-not-allowed text-muted-foreground/45"
							)}
							disabled={!canOpenStep(key)}
							onClick={() => openStep(key)}
							type="button"
						>
							{label}
						</button>
					</span>
				))}
			</nav>

			<div className="grid min-h-[calc(100svh-13rem)] place-items-center py-10">
				<form className="w-full max-w-md space-y-8" onSubmit={handleSubmit}>
					{step === "slug" ? (
						<div className="space-y-2">
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
												: canContinueSlug
													? "text-success"
													: "text-muted-foreground"
										)}
									>
										{slugTaken
											? "Taken"
											: canContinueSlug
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
									onChange={(event) =>
										setSlug(sanitizeSlug(event.target.value))
									}
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
								disabled={!canContinueSlug}
								icon="arrow-right"
								size="lg"
								type="submit"
							>
								Continue
							</AnimatedIconButton>
						</div>
					) : step === "password" ? (
						<div className="space-y-2">
							<div className="space-y-2">
								<div className="flex items-end justify-between gap-3">
									<Label className="text-[15px]" htmlFor="box-password">
										Password
									</Label>
									<span
										aria-live="polite"
										className={cn(
											"text-right text-xs font-medium leading-tight",
											passwordToneClass(
												password,
												passwordStrength.ok,
												currentBreachCheck
											)
										)}
									>
										{passwordMessage(
											password,
											passwordStrength.message,
											currentBreachCheck
										)}
									</span>
								</div>
								<Input
									aria-invalid={
										password.length > 0 &&
										(!passwordStrength.ok || passwordFoundInBreach)
									}
									autoComplete="new-password"
									className="h-12 rounded-lg px-5 text-[15px]"
									id="box-password"
									name="password"
									onChange={(event) => handlePasswordChange(event.target.value)}
									ref={passwordInputRef}
									type="password"
									value={password}
								/>
							</div>
							<div className="flex flex-col-reverse gap-2 sm:flex-row">
								<AnimatedIconButton
									className="h-12 rounded-lg text-[15px] sm:flex-1"
									icon="arrow-left"
									iconPosition="start"
									onClick={() => setStep("slug")}
									size="lg"
									type="button"
									variant="outline"
								>
									Back
								</AnimatedIconButton>
								<AnimatedIconButton
									className="h-12 rounded-lg text-[15px] sm:flex-1"
									disabled={!canContinuePassword}
									icon="arrow-right"
									size="lg"
									type="submit"
								>
									Continue
								</AnimatedIconButton>
							</div>
						</div>
					) : (
						<div className="space-y-2">
							<div className="space-y-2">
								<div className="flex items-end justify-between gap-3">
									<Label className="text-[15px]" htmlFor="box-password-confirm">
										Confirm password
									</Label>
									<span
										aria-live="polite"
										className={cn(
											"text-xs font-medium",
											passwordsMismatch
												? "text-destructive"
												: confirmation.length > 0
													? "text-success"
													: "text-muted-foreground"
										)}
									>
										{passwordsMismatch
											? "Does not match"
											: confirmation.length > 0
												? "Matches"
												: ""}
									</span>
								</div>
								<Input
									aria-invalid={passwordsMismatch}
									autoComplete="new-password"
									className="h-12 rounded-lg px-5 text-[15px]"
									id="box-password-confirm"
									name="confirmation"
									onChange={(event) => setConfirmation(event.target.value)}
									ref={confirmationInputRef}
									type="password"
									value={confirmation}
								/>
							</div>
							<div className="flex flex-col-reverse gap-2 sm:flex-row">
								<AnimatedIconButton
									className="h-12 rounded-lg text-[15px] sm:flex-1"
									disabled={submitting}
									icon="arrow-left"
									iconPosition="start"
									onClick={() => setStep("password")}
									size="lg"
									type="button"
									variant="outline"
								>
									Back
								</AnimatedIconButton>
								<AnimatedIconButton
									className="h-12 rounded-lg text-[15px] sm:flex-1"
									disabled={!canCheckout || submitting}
									icon="arrow-right"
									size="lg"
									type="submit"
								>
									Continue to checkout
								</AnimatedIconButton>
							</div>
						</div>
					)}
				</form>
			</div>
		</div>
	);
}

function passwordToneClass(
	password: string,
	strengthOk: boolean,
	check: PasswordBreachCheck
) {
	if (!password) return "text-muted-foreground";
	if (!strengthOk || check.status === "found") return "text-destructive";
	if (check.status === "unavailable") return "text-warning";
	if (check.status === "clear") return "text-success";
	return "text-muted-foreground";
}

function passwordMessage(
	password: string,
	strengthMessage: string,
	check: PasswordBreachCheck
) {
	if (!password) return "";
	if (check.status === "checking") return "Checking known breaches.";
	if (check.status === "found") {
		return `Found in ${formatBreachCount(check.count)} breach records. Choose another password.`;
	}
	if (check.status === "clear") return "Not found in known breaches.";
	if (check.status === "unavailable") {
		return "Breach check unavailable. You can continue.";
	}
	return strengthMessage;
}

function formatBreachCount(count = 0) {
	return new Intl.NumberFormat("en").format(count);
}
