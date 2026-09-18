import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import {
	inputClassName,
	inputControlClassName,
	inputFrameClassName,
} from "@/components/ui/input";
import { linkClassName } from "@/components/ui/link";

const navbarButtonClassName = `${buttonVariants.ghost} aria-[current=page]:bg-surface-active aria-[current=page]:hover:bg-surface-active data-[active=true]:bg-surface-active data-[active=true]:hover:bg-surface-active`;
const dataDangerFilledClassName =
	"data-[color=danger]:border-danger data-[color=danger]:bg-danger data-[color=danger]:text-danger-foreground data-[color=danger]:enabled:hover:border-danger-hover data-[color=danger]:enabled:hover:bg-danger-hover data-[color=danger]:enabled:active:border-danger-active data-[color=danger]:enabled:active:bg-danger-active";
const dataDangerGhostClassName =
	"data-[color=danger]:text-danger-text data-[color=danger]:enabled:hover:bg-danger-surface-hover data-[color=danger]:enabled:active:bg-danger-surface-active";
const clerkPrimaryButtonClassName = `${buttonVariants.primary} ${dataDangerFilledClassName}`;
const clerkGhostButtonClassName = `${buttonVariants.ghost} ${dataDangerGhostClassName}`;
const clerkContentSurfaceClassName = "bg-surface";

/** Clerk's own theme variables are set in app/clerk.css. */
export function ClerkClientProvider({ children }: { children: ReactNode }) {
	return (
		<ClerkProvider
			appearance={{
				cssLayerName: "clerk",
				elements: {
					accordionTriggerButton: buttonVariants.ghost,
					actionCard: cardSurface,
					alternativeMethodsBlockButton: buttonVariants.secondary,
					avatarImageActionsRemove: buttonVariants.dangerGhost,
					avatarImageActionsUpload: buttonVariants.secondary,
					avatarBox: "rounded-none",
					badge:
						"rounded-none border border-border bg-muted-surface text-foreground",
					card: clerkContentSurfaceClassName,
					cardBox: cardSurface,
					dividerLine: "bg-border",
					drawerContent: cardSurface,
					fileDropAreaBox: "border border-border bg-background",
					fileDropAreaButtonPrimary: buttonVariants.secondary,
					fileDropAreaButtonSecondary: buttonVariants.ghost,
					fileDropAreaIconBox: "bg-muted-surface",
					footer: "bg-surface",
					footerActionLink: linkClassName,
					formButtonPrimary: clerkPrimaryButtonClassName,
					formButtonReset: buttonVariants.ghost,
					formFieldAction: linkClassName,
					formFieldInput: inputClassName,
					formFieldInputShowPasswordButton: buttonVariants.ghost,
					formInputGroup: inputFrameClassName,
					formResendCodeLink: linkClassName,
					identityPreviewEditButton: linkClassName,
					menuButton: buttonVariants.ghost,
					menuItem: clerkGhostButtonClassName,
					menuList: cardSurface,
					modalCloseButton: buttonVariants.ghost,
					navbar: "border-0 border-border border-e bg-split-panel-navigation",
					navbarButton: navbarButtonClassName,
					organizationSwitcherPopoverMain: clerkContentSurfaceClassName,
					otpCodeFieldInput: inputControlClassName,
					pageScrollBox: "bg-split-panel-content",
					phoneInputBox: inputFrameClassName,
					popoverBox: cardSurface,
					pricingTableCard: cardSurface,
					profileSection: "border-border",
					profileSectionPrimaryButton: clerkGhostButtonClassName,
					scrollBox: "bg-split-panel-content",
					selectButton: buttonVariants.secondary,
					socialButtonsBlockButton: buttonVariants.secondary,
					table: cardSurface,
					tagPillContainer: "border border-border bg-muted-surface",
					userButtonPopoverActionButton: buttonVariants.ghost,
					userButtonPopoverCard: cardSurface,
					userButtonPopoverMain: clerkContentSurfaceClassName,
					userButtonTrigger: "rounded-none",
				},
			}}
			localization={{
				userProfile: {
					deletePage: {
						messageLine2:
							"All owned servers will be deleted. You cannot undo this.",
					},
				},
			}}
		>
			{children}
		</ClerkProvider>
	);
}
