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
	const [termsAccepted, setTermsAccepted] = useState(false);
	// A weak or breached password is allowed, but only through an escalating
	// confirm: pwStage counts how many warnings the user has clicked past, and
	// passwordCleared marks the password step as passed.
	const [pwStage, setPwStage] = useState(0);
	const [passwordCleared, setPasswordCleared] = useState(false);
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
	// Weak/breached passwords are gated by an escalating confirm, not blocked.
	// The active stage drives the submit button's label and colour.
	const confirmStages =
		password.length > 0
			? passwordConfirmStages(passwordStrength.ok, currentBreachCheck.status)
			: [];
	const activeStage = confirmStages[pwStage];
	const canContinuePassword = passwordCleared;
	const canCheckout =
		passwordCleared && confirmation === password && termsAccepted;
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
		setPwStage(0);
		setPasswordCleared(false);
		setPassword(value);
	}

	async function ensureBreachChecked(
		value: string
	): Promise<PasswordBreachCheck["status"]> {
		if (currentBreachCheck.password === value) {
			if (currentBreachCheck.status === "clear") return "clear";
			if (currentBreachCheck.status === "found") return "found";
			if (currentBreachCheck.status === "unavailable") return "unavailable";
		}

		passwordBreachAbortRef.current?.abort();
		const controller = new AbortController();
		passwordBreachAbortRef.current = controller;
		setBreachCheck({ password: value, status: "checking" });

		try {
			const count = await checkPwnedBoxPassword(value, controller.signal);
			if (controller.signal.aborted) return "unavailable";

			const status = count > 0 ? "found" : "clear";
			setBreachCheck({ count, password: value, status });
			return status;
		} catch {
			if (controller.signal.aborted) return "unavailable";

			setBreachCheck({ password: value, status: "unavailable" });
			toast.warning("Breach check unavailable", {
				description: "You can continue, but the password was not checked."
			});
			return "unavailable";
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
			if (password.length === 0 || checkingPasswordBreach) return;

			const alreadyBreached = currentBreachCheck.status === "found";
			const breach = await ensureBreachChecked(password);
			const stages = passwordConfirmStages(passwordStrength.ok, breach);

			// A newly discovered breach reveals its first (amber) warning without
			// spending a confirmation, so the user still gets the amber-then-red
			// escalation rather than jumping straight to red.
			if (breach === "found" && !alreadyBreached) {
				setPwStage(0);
				return;
			}

			// Each remaining click escalates one stage; the last click proceeds.
			if (pwStage < stages.length - 1) {
				setPwStage(pwStage + 1);
				return;
			}

			setPasswordCleared(true);
			setStep("confirm");
			return;
		}

		if (!canCheckout || submitting) return;

		setSubmitting(true);
		try {
			const checkout = await createCheckout({
				legalAccepted: termsAccepted,
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
									aria-invalid={password.length > 0 && passwordFoundInBreach}
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
									disabled={password.length === 0 || checkingPasswordBreach}
									icon="arrow-right"
									size="lg"
									type="submit"
									variant={activeStage?.variant ?? "default"}
								>
									{activeStage?.text ?? "Continue"}
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
							<label className="flex cursor-pointer items-start gap-3 py-2 text-sm leading-5 text-muted-foreground">
								<input
									checked={termsAccepted}
									className="mt-0.5 size-4 rounded border-border accent-primary"
									onChange={(event) => setTermsAccepted(event.target.checked)}
									type="checkbox"
								/>
								<span>
									I agree to the{" "}
									<Link
										className="text-foreground underline underline-offset-4"
										href="/terms"
										target="_blank"
									>
										Terms of Service
									</Link>{" "}
									and request that Composery Cloud start immediately. I
									understand this is a recurring subscription and that I may owe
									a proportionate amount for service supplied if I withdraw
									within 14 days.
								</span>
							</label>
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

type ConfirmStage = { text: string; variant: "warning" | "destructive" };

// The confirmation a password needs before checkout: weak -> one amber "Use
// anyway?", breached -> one red one. Empty means it's ready to go.
function passwordConfirmStages(
	strengthOk: boolean,
	breachStatus: PasswordBreachCheck["status"]
): ConfirmStage[] {
	if (breachStatus === "found") {
		return [{ text: "Use anyway?", variant: "destructive" }];
	}
	if (!strengthOk) {
		return [{ text: "Use anyway?", variant: "warning" }];
	}
	return [];
}

function passwordToneClass(
	password: string,
	strengthOk: boolean,
	check: PasswordBreachCheck
) {
	if (!password) return "text-muted-foreground";
	if (check.status === "found") return "text-destructive";
	// Weak is allowed with a confirm, so it reads as a caution, not an error.
	if (!strengthOk) return "text-warning";
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
		return `Found in ${formatBreachCount(check.count)} breach records. Not recommended.`;
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
