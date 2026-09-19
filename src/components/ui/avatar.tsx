"use client";

import clsx from "clsx";
import {
	type ComponentProps,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	controlRadiusClassName,
	controlRadiusClassNames,
} from "@/components/ui/interaction";
import { Spinner } from "@/components/ui/spinner";

const spinnerDelayMs = 150;
const spinnerMinimumDurationMs = 400;

export const avatarClassName =
	"relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-muted-surface text-foreground shadow-none";
export const avatarImageClassName = "size-full object-cover transition-opacity";
export const avatarFallbackClassName =
	"flex size-full items-center justify-center";
export const avatarLoadingClassName =
	"absolute inset-0 flex items-center justify-center bg-muted-surface";

export const avatarSizes = {
	small: `${controlRadiusClassName} size-8 text-xs`,
	medium: `${controlRadiusClassNames.large} size-10 text-sm`,
	large: `${controlRadiusClassNames.large} size-16 text-lg`,
} as const;

type AvatarImageProps = {
	alt: string;
	fallback: string;
	showLoadingSpinner: boolean;
	src: string;
};

function AvatarImage({
	alt,
	fallback,
	showLoadingSpinner,
	src,
}: AvatarImageProps) {
	const [hasError, setHasError] = useState(false);
	const [hasLoaded, setHasLoaded] = useState(false);
	const [isSpinnerVisible, setIsSpinnerVisible] = useState(false);
	const spinnerShownAt = useRef<number | null>(null);
	const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		return () => {
			if (finishTimer.current !== null) {
				clearTimeout(finishTimer.current);
			}
		};
	}, []);

	useEffect(() => {
		if (!showLoadingSpinner || hasLoaded || hasError) {
			return;
		}

		const timer = setTimeout(() => {
			setIsSpinnerVisible(true);
			spinnerShownAt.current = Date.now();
		}, spinnerDelayMs);

		return () => clearTimeout(timer);
	}, [hasError, hasLoaded, showLoadingSpinner]);

	const finishLoading = useCallback(() => {
		if (spinnerShownAt.current !== null) {
			const elapsed = Date.now() - spinnerShownAt.current;
			const remaining = spinnerMinimumDurationMs - elapsed;
			if (remaining > 0) {
				finishTimer.current = setTimeout(() => {
					finishTimer.current = null;
					setHasLoaded(true);
				}, remaining);
				return;
			}
		}

		setHasLoaded(true);
	}, []);

	const handleImageError = useCallback(() => {
		if (finishTimer.current !== null) {
			clearTimeout(finishTimer.current);
			finishTimer.current = null;
		}
		setHasError(true);
	}, []);

	if (hasError) {
		return (
			<span aria-label={alt} role="img" className={avatarFallbackClassName}>
				{fallback}
			</span>
		);
	}

	const showSpinner = showLoadingSpinner && isSpinnerVisible && !hasLoaded;
	return (
		<>
			{/* biome-ignore lint/performance/noImgElement: external avatar URL */}
			<img
				alt={alt}
				decoding="sync"
				src={src}
				className={clsx(
					avatarImageClassName,
					showLoadingSpinner && !hasLoaded ? "opacity-0" : "opacity-100",
				)}
				onError={handleImageError}
				onLoad={finishLoading}
			/>
			{showSpinner ? (
				<span className={avatarLoadingClassName}>
					<Spinner size="small" label={`Loading ${alt}`} />
				</span>
			) : null}
		</>
	);
}

type AvatarProps = Omit<ComponentProps<"span">, "children"> & {
	alt: string;
	fallback: string;
	showLoadingSpinner?: boolean | undefined;
	size?: keyof typeof avatarSizes | undefined;
	src?: string | null | undefined;
};

export function Avatar({
	alt,
	className,
	fallback,
	showLoadingSpinner = false,
	size = "medium",
	src,
	...props
}: AvatarProps) {
	return (
		<span
			className={clsx(avatarClassName, avatarSizes[size], className)}
			{...props}
		>
			{src ? (
				<AvatarImage
					key={src}
					alt={alt}
					fallback={fallback}
					showLoadingSpinner={showLoadingSpinner}
					src={src}
				/>
			) : (
				<span aria-label={alt} role="img" className={avatarFallbackClassName}>
					{fallback}
				</span>
			)}
		</span>
	);
}
