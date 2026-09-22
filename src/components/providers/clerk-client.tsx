import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";
import { alertClassName, alertVariantClassNames } from "@/components/ui/alert";
import { badgeClassName } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cardSurface, menuSurfaceClassName } from "@/components/ui/card";
import {
	fieldDescriptionClassName,
	fieldLabelClassName,
	fieldMessageClassNames,
} from "@/components/ui/field";
import {
	inputClassName,
	inputControlClassName,
	inputFrameClassName,
	textareaClassName,
} from "@/components/ui/input";
import { controlRadiusClassName } from "@/components/ui/interaction";
import { linkClassName } from "@/components/ui/link";
import {
	radioGroupClassName,
	radioGroupItemClassName,
	radioInputClassName,
	radioLabelClassName,
	radioLabelTitleClassName,
} from "@/components/ui/radio-group";
import { separatorLineClassName } from "@/components/ui/separator";
import {
	switchIndicatorClassName,
	switchLabelClassName,
	switchRootClassName,
	switchThumbClassName,
} from "@/components/ui/switch";

const navbarButtonClassName = `${buttonVariants.ghost} aria-[current=page]:bg-surface-active aria-[current=page]:hover:bg-surface-active data-[active=true]:bg-surface-active data-[active=true]:hover:bg-surface-active`;
const clerkPrimaryButtonClassName = `${buttonVariants.primary} clerk-button-primary`;
const clerkGhostButtonClassName = `${buttonVariants.ghost} clerk-button-ghost`;
const clerkContentSurfaceClassName = "bg-surface";
const clerkAvatarClassName = controlRadiusClassName;
const clerkBadgeClassName = `${badgeClassName} clerk-badge`;
const clerkSwitchIndicatorClassName = `${switchIndicatorClassName} clerk-switch-indicator`;

// biome-ignore-start lint/style/useNamingConvention: external IDs use double underscores
const clerkTextInputElements = {
	formFieldInput__acsUrl: inputClassName,
	formFieldInput__affiliationEmailAddress: inputClassName,
	formFieldInput__apiKeyDescription: inputClassName,
	formFieldInput__apiKeyExpirationDate: inputClassName,
	formFieldInput__apiKeyRevokeConfirmation: inputClassName,
	formFieldInput__apiKeySecret: inputClassName,
	formFieldInput__authUrl: inputClassName,
	formFieldInput__clientId: inputClassName,
	formFieldInput__clientSecret: inputClassName,
	formFieldInput__confirmPassword: inputClassName,
	formFieldInput__currentPassword: inputClassName,
	formFieldInput__deleteConfirmation: inputClassName,
	formFieldInput__deleteOrganizationConfirmation: inputClassName,
	formFieldInput__discoveryUrl: inputClassName,
	formFieldInput__domain: inputClassName,
	formFieldInput__emailAddress: inputClassName,
	formFieldInput__firstName: inputClassName,
	formFieldInput__idpEntityId: inputClassName,
	formFieldInput__idpMetadataUrl: inputClassName,
	formFieldInput__idpSsoUrl: inputClassName,
	formFieldInput__identifier: inputClassName,
	formFieldInput__lastName: inputClassName,
	formFieldInput__name: inputClassName,
	formFieldInput__newPassword: inputClassName,
	formFieldInput__passkeyName: inputClassName,
	formFieldInput__password: inputClassName,
	formFieldInput__redirectUri: inputClassName,
	formFieldInput__slug: inputClassName,
	formFieldInput__spEntityId: inputClassName,
	formFieldInput__tokenUrl: inputClassName,
	formFieldInput__userInfoUrl: inputClassName,
	formFieldInput__username: inputClassName,
	formFieldInput__web3WalletName: inputClassName,
} as const;

const clerkTextareaElements = {
	formFieldInput__idpCertificate: textareaClassName,
	formFieldInput__idpMetadata: textareaClassName,
} as const;
// biome-ignore-end lint/style/useNamingConvention: external IDs use double underscores

// biome-ignore-start lint/style/useNamingConvention: external acronym casing
const clerkDirectInputElements = {
	apiKeysCopyModalInput: inputClassName,
	apiKeysCreateFormDescriptionInput: inputClassName,
	apiKeysCreateFormExpirationInput: inputClassName,
	apiKeysCreateFormNameInput: inputClassName,
	apiKeysRevokeModalInput: inputClassName,
	apiKeysSearchInput: inputClassName,
	configureSSOEmailVerificationInput: inputClassName,
	configureSSOResetConnectionDialogConfirmationInput: inputClassName,
	organizationProfileMembersSearchInput: inputClassName,
	searchInput: inputClassName,
	selectSearchInput: inputClassName,
} as const;
// biome-ignore-end lint/style/useNamingConvention: external acronym casing

export function ClerkClientProvider({ children }: { children: ReactNode }) {
	return (
		<ClerkProvider
			appearance={{
				cssLayerName: "clerk",
				elements: {
					...clerkDirectInputElements,
					...clerkTextInputElements,
					...clerkTextareaElements,
					accountSwitcherActionButton: buttonVariants.ghost,
					accordionTriggerButton: buttonVariants.ghost,
					actionCard: cardSurface,
					alert: alertClassName,
					// biome-ignore lint/style/useNamingConvention: external IDs use double underscores
					alert__danger: alertVariantClassNames.danger,
					// biome-ignore lint/style/useNamingConvention: external IDs use double underscores
					alert__info: alertVariantClassNames.neutral,
					// biome-ignore lint/style/useNamingConvention: external IDs use double underscores
					alert__warning: alertVariantClassNames.warning,
					alternativeMethodsBlockButton: buttonVariants.secondary,
					avatarImageActionsRemove: buttonVariants.dangerGhost,
					avatarImageActionsUpload: buttonVariants.secondary,
					avatarBox: clerkAvatarClassName,
					backLink: linkClassName,
					badge: clerkBadgeClassName,
					card: clerkContentSurfaceClassName,
					cardBox: cardSurface,
					dividerLine: separatorLineClassName,
					drawerClose: buttonVariants.ghost,
					drawerContent: cardSurface,
					fileDropAreaButtonPrimary: buttonVariants.secondary,
					fileDropAreaButtonSecondary: buttonVariants.ghost,
					footer: "bg-surface",
					footerActionLink: linkClassName,
					footerPagesLink: linkClassName,
					formButtonPrimary: clerkPrimaryButtonClassName,
					formButtonReset: buttonVariants.ghost,
					formFieldAction: linkClassName,
					formFieldCheckboxLabel: fieldLabelClassName,
					formFieldErrorText: fieldMessageClassNames.error,
					formFieldHintText: fieldDescriptionClassName,
					formFieldInfoText: fieldMessageClassNames.info,
					formFieldInputCopyToClipboardButton: buttonVariants.ghost,
					formFieldInputShowPasswordButton: buttonVariants.ghost,
					formFieldLabel: fieldLabelClassName,
					formFieldRadioGroup: radioGroupClassName,
					formFieldRadioGroupItem: radioGroupItemClassName,
					formFieldRadioInput: radioInputClassName,
					formFieldRadioLabel: radioLabelClassName,
					formFieldRadioLabelDescription: fieldDescriptionClassName,
					formFieldRadioLabelTitle: radioLabelTitleClassName,
					formFieldSuccessText: fieldMessageClassNames.success,
					formFieldWarningText: fieldMessageClassNames.warning,
					formInputGroup: inputFrameClassName,
					formResendCodeLink: linkClassName,
					headerBackLink: linkClassName,
					identityPreviewEditButton: linkClassName,
					lastAuthenticationStrategyBadge: clerkBadgeClassName,
					menuButton: buttonVariants.ghost,
					menuItem: clerkGhostButtonClassName,
					menuList: menuSurfaceClassName,
					modalCloseButton: buttonVariants.ghost,
					navbar: "border-0 border-border border-e bg-split-panel-navigation",
					navbarButton: navbarButtonClassName,
					navbarMobileMenuButton: buttonVariants.ghost,
					organizationSwitcherPopoverMain: clerkContentSurfaceClassName,
					notificationBadge: clerkBadgeClassName,
					otpCodeFieldInput: inputControlClassName,
					pageScrollBox: "bg-split-panel-content",
					phoneInputBox: inputFrameClassName,
					popoverBox: menuSurfaceClassName,
					pricingTableCard: cardSurface,
					profileSection: "border-border",
					profileSectionPrimaryButton: clerkGhostButtonClassName,
					scrollBox: "bg-split-panel-content",
					searchInputClearButton: buttonVariants.ghost,
					selectButton: buttonVariants.secondary,
					selectOptionsContainer: menuSurfaceClassName,
					socialButtonsIconButton: buttonVariants.secondary,
					socialButtonsBlockButton: buttonVariants.secondary,
					switchIndicator: clerkSwitchIndicatorClassName,
					switchLabel: switchLabelClassName,
					switchRoot: switchRootClassName,
					switchThumb: switchThumbClassName,
					userAvatarBox: clerkAvatarClassName,
					userButtonAvatarBox: clerkAvatarClassName,
					userButtonPopoverActionButton: buttonVariants.ghost,
					userButtonPopoverCard: menuSurfaceClassName,
					userButtonPopoverFooterPagesLink: linkClassName,
					userButtonPopoverMain: clerkContentSurfaceClassName,
					userPreviewAvatarBox: clerkAvatarClassName,
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
