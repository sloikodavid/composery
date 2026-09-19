"use client";

import { Toast } from "@base-ui/react/toast";
import clsx from "clsx";
import type { ReactNode } from "react";
import {
	buttonClassName,
	buttonLinkClassName,
	buttonSizes,
	buttonVariants,
} from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";

export const toastManager = Toast.createToastManager();

function ToastList() {
	const { toasts } = Toast.useToastManager();
	return toasts.map((toast) => (
		<Toast.Root
			key={toast.id}
			toast={toast}
			className={clsx(
				cardSurface,
				"pointer-events-auto absolute right-0 bottom-0 left-auto z-[calc(1000-var(--toast-index))] h-[var(--height)] w-full origin-bottom text-sm transition-[transform,opacity,height] duration-300 ease-out [--gap:0.5rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc((var(--toast-offset-y)*-1)+(var(--toast-index)*var(--gap)*-1)+var(--toast-swipe-movement-y))] [--peek:0.5rem] [--scale:calc(max(0,1-(var(--toast-index)*0.05)))] [--shrink:calc(1-var(--scale))] [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)-(var(--toast-index)*var(--peek))-(var(--shrink)*var(--height))))_scale(var(--scale))] after:absolute after:top-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-[''] data-[expanded]:h-[var(--toast-height)] data-[ending-style]:opacity-0 data-[limited]:opacity-0 motion-reduce:transform-none motion-reduce:transition-none data-[swipe-direction=down]:data-[ending-style]:[transform:translateY(calc(var(--toast-swipe-movement-y)+150%))] data-[swipe-direction=left]:data-[ending-style]:[transform:translateX(calc(var(--toast-swipe-movement-x)-150%))_translateY(var(--offset-y))] data-[swipe-direction=right]:data-[ending-style]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))] data-[swipe-direction=up]:data-[ending-style]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))] data-[expanded]:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))] data-[starting-style]:[transform:translateY(150%)]",
			)}
		>
			<Toast.Content className="flex min-w-0 items-start gap-3 overflow-hidden p-4 transition-opacity duration-150 data-[behind]:opacity-0 data-[expanded]:opacity-100 motion-reduce:transition-none">
				<div className="flex min-w-0 flex-1 flex-col gap-1 break-words">
					{toast.title !== undefined && toast.title !== null ? (
						<Toast.Title className="font-brand text-foreground" />
					) : null}
					{toast.description !== undefined && toast.description !== null ? (
						<Toast.Description className="text-muted" />
					) : null}
				</div>
				<div className="flex shrink-0 items-start gap-1">
					<Toast.Action
						onPointerDown={(event) => event.preventDefault()}
						className={clsx(
							buttonClassName,
							buttonVariants.secondary,
							buttonSizes.small,
						)}
					/>
					<Toast.Close
						onPointerDown={(event) => event.preventDefault()}
						className={buttonLinkClassName}
					>
						Close
					</Toast.Close>
				</div>
			</Toast.Content>
		</Toast.Root>
	));
}

export function ToastProvider({ children }: { children: ReactNode }) {
	return (
		<Toast.Provider
			toastManager={toastManager}
			limit={Number.POSITIVE_INFINITY}
			timeout={5000}
		>
			{children}
			<Toast.Portal>
				<Toast.Viewport className="pointer-events-none fixed right-4 bottom-4 z-50 w-80 max-w-[calc(100vw-2rem)] outline-none">
					<ToastList />
				</Toast.Viewport>
			</Toast.Portal>
		</Toast.Provider>
	);
}
