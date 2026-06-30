"use client";

import Link from "next/link";
import type {
	AnchorHTMLAttributes,
	ComponentProps,
	FocusEventHandler,
	MouseEventHandler,
	ReactNode,
	Ref
} from "react";
import { useRef } from "react";

import { ArrowRightIcon } from "@/components/icons/arrow-right";
import { ArrowUpRightIcon } from "@/components/icons/arrow-up-right";
import { BookOpenIcon } from "@/components/icons/book-open";
import { CheckIcon } from "@/components/icons/check";
import { ConstructionIcon } from "@/components/icons/construction";
import { ConvexIcon } from "@/components/icons/convex";
import { CopyIcon } from "@/components/icons/copy";
import { CreditCardIcon } from "@/components/icons/credit-card";
import { DeleteIcon } from "@/components/icons/delete";
import { DownloadIcon } from "@/components/icons/download";
import { GithubIcon } from "@/components/icons/github";
import { HetznerIcon } from "@/components/icons/hetzner";
import { LayoutGridIcon } from "@/components/icons/layout-grid";
import { LockIcon } from "@/components/icons/lock";
import { LogInIcon } from "@/components/icons/login";
import { PenToolIcon } from "@/components/icons/pen-tool";
import { PlayIcon } from "@/components/icons/play";
import { PlusIcon } from "@/components/icons/plus";
import { PolarIcon } from "@/components/icons/polar";
import { RotateCWIcon } from "@/components/icons/rotate-cw";
import { SquarePenIcon } from "@/components/icons/square-pen";
import { SunMoonIcon } from "@/components/icons/sun-moon";
import { VercelIcon } from "@/components/icons/vercel";
import { WalletIcon } from "@/components/icons/wallet";
import { WashingMachineIcon } from "@/components/icons/washing-machine";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";

export type AnimatedIconHandle = {
	startAnimation: () => void | Promise<void>;
	stopAnimation: () => void | Promise<void>;
};

export type AnimatedIconName =
	| "arrow-right"
	| "arrow-up-right"
	| "book-open"
	| "check"
	| "construction"
	| "convex"
	| "copy"
	| "credit-card"
	| "delete"
	| "download"
	| "github"
	| "hetzner"
	| "layout-grid"
	| "lock"
	| "login"
	| "pen-tool"
	| "play"
	| "plus"
	| "polar"
	| "rotate-cw"
	| "square-pen"
	| "sun-moon"
	| "vercel"
	| "wallet"
	| "washing-machine";

type AnimatedIconPosition = "start" | "end" | "only";

type SharedProps = {
	children?: ReactNode;
	icon: AnimatedIconName;
	iconClassName?: string;
	iconPosition?: AnimatedIconPosition;
	iconSize?: number;
};

type HandlerProps<T extends HTMLElement> = {
	onBlur?: FocusEventHandler<T>;
	onFocus?: FocusEventHandler<T>;
	onMouseEnter?: MouseEventHandler<T>;
	onMouseLeave?: MouseEventHandler<T>;
};

function useAnimatedIconHandlers<T extends HTMLElement>({
	onBlur,
	onFocus,
	onMouseEnter,
	onMouseLeave
}: HandlerProps<T>) {
	const iconRef = useRef<AnimatedIconHandle>(null);

	return {
		iconRef,
		handlers: {
			onBlur: (event) => {
				void iconRef.current?.stopAnimation();
				onBlur?.(event);
			},
			onFocus: (event) => {
				void iconRef.current?.startAnimation();
				onFocus?.(event);
			},
			onMouseEnter: (event) => {
				void iconRef.current?.startAnimation();
				onMouseEnter?.(event);
			},
			onMouseLeave: (event) => {
				void iconRef.current?.stopAnimation();
				onMouseLeave?.(event);
			}
		} satisfies HandlerProps<T>
	};
}

function AnimatedIconGlyph({
	className,
	icon,
	iconRef,
	position,
	size = 16
}: {
	className?: string;
	icon: AnimatedIconName;
	iconRef: Ref<AnimatedIconHandle>;
	position: AnimatedIconPosition;
	size?: number;
}) {
	const iconProps = {
		"aria-hidden": true,
		className: cn("size-4", className),
		"data-icon": position === "only" ? undefined : `inline-${position}`,
		ref: iconRef,
		size
	};

	switch (icon) {
		case "arrow-right":
			return <ArrowRightIcon {...iconProps} />;
		case "arrow-up-right":
			return <ArrowUpRightIcon {...iconProps} />;
		case "book-open":
			return <BookOpenIcon {...iconProps} />;
		case "check":
			return <CheckIcon {...iconProps} />;
		case "construction":
			return <ConstructionIcon {...iconProps} />;
		case "convex":
			return <ConvexIcon {...iconProps} />;
		case "copy":
			return <CopyIcon {...iconProps} />;
		case "credit-card":
			return <CreditCardIcon {...iconProps} />;
		case "delete":
			return <DeleteIcon {...iconProps} />;
		case "download":
			return <DownloadIcon {...iconProps} />;
		case "github":
			return <GithubIcon {...iconProps} />;
		case "hetzner":
			return <HetznerIcon {...iconProps} />;
		case "layout-grid":
			return <LayoutGridIcon {...iconProps} />;
		case "lock":
			return <LockIcon {...iconProps} />;
		case "login":
			return <LogInIcon {...iconProps} />;
		case "pen-tool":
			return <PenToolIcon {...iconProps} />;
		case "play":
			return <PlayIcon {...iconProps} />;
		case "plus":
			return <PlusIcon {...iconProps} />;
		case "polar":
			return <PolarIcon {...iconProps} />;
		case "rotate-cw":
			return <RotateCWIcon {...iconProps} />;
		case "square-pen":
			return <SquarePenIcon {...iconProps} />;
		case "sun-moon":
			return <SunMoonIcon {...iconProps} />;
		case "vercel":
			return <VercelIcon {...iconProps} />;
		case "wallet":
			return <WalletIcon {...iconProps} />;
		case "washing-machine":
			return <WashingMachineIcon {...iconProps} />;
	}
}

function AnimatedIconContents({
	children,
	icon,
	iconClassName,
	iconPosition = "end",
	iconRef,
	iconSize
}: SharedProps & { iconRef: Ref<AnimatedIconHandle> }) {
	const glyph = (
		<AnimatedIconGlyph
			className={iconClassName}
			icon={icon}
			iconRef={iconRef}
			position={iconPosition}
			size={iconSize}
		/>
	);

	return (
		<>
			{iconPosition !== "end" ? glyph : null}
			{children}
			{iconPosition === "end" ? glyph : null}
		</>
	);
}

type AnimatedIconLinkProps = ComponentProps<typeof Link> & SharedProps;

export function AnimatedIconLink({
	children,
	icon,
	iconClassName,
	iconPosition,
	iconSize,
	onBlur,
	onFocus,
	onMouseEnter,
	onMouseLeave,
	...props
}: AnimatedIconLinkProps) {
	const { handlers, iconRef } = useAnimatedIconHandlers<HTMLAnchorElement>({
		onBlur,
		onFocus,
		onMouseEnter,
		onMouseLeave
	});

	return (
		<Link {...props} {...handlers}>
			<AnimatedIconContents
				icon={icon}
				iconClassName={iconClassName}
				iconPosition={iconPosition}
				iconRef={iconRef}
				iconSize={iconSize}
			>
				{children}
			</AnimatedIconContents>
		</Link>
	);
}

type AnimatedIconAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> &
	SharedProps;

export function AnimatedIconAnchor({
	children,
	icon,
	iconClassName,
	iconPosition,
	iconSize,
	onBlur,
	onFocus,
	onMouseEnter,
	onMouseLeave,
	...props
}: AnimatedIconAnchorProps) {
	const { handlers, iconRef } = useAnimatedIconHandlers<HTMLAnchorElement>({
		onBlur,
		onFocus,
		onMouseEnter,
		onMouseLeave
	});

	return (
		<a {...props} {...handlers}>
			<AnimatedIconContents
				icon={icon}
				iconClassName={iconClassName}
				iconPosition={iconPosition}
				iconRef={iconRef}
				iconSize={iconSize}
			>
				{children}
			</AnimatedIconContents>
		</a>
	);
}

type AnimatedIconButtonProps = ComponentProps<typeof Button> & SharedProps;

export function AnimatedIconButton({
	children,
	icon,
	iconClassName,
	iconPosition,
	iconSize,
	onBlur,
	onFocus,
	onMouseEnter,
	onMouseLeave,
	...props
}: AnimatedIconButtonProps) {
	const { handlers, iconRef } = useAnimatedIconHandlers<HTMLButtonElement>({
		onBlur,
		onFocus,
		onMouseEnter,
		onMouseLeave
	});

	return (
		<Button {...props} {...handlers}>
			<AnimatedIconContents
				icon={icon}
				iconClassName={iconClassName}
				iconPosition={iconPosition}
				iconRef={iconRef}
				iconSize={iconSize}
			>
				{children}
			</AnimatedIconContents>
		</Button>
	);
}
