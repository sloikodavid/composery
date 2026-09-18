"use client";

import { Toast } from "@base-ui/react/toast";
import clsx from "clsx";
import type { ReactNode } from "react";
import {
	buttonClassName,
	buttonSizes,
	buttonVariants,
} from "@/components/ui/button";
import { cardSurface } from "@/components/ui/card";
import { linkClassName } from "@/components/ui/link";

/** Adds a floating message for a transient outcome, from any code on the client. */
export const toastManager = Toast.createToastManager();

function ToastList() {
	const { toasts } = Toast.useToastManager();
	return toasts.map((toast) => (
		<Toast.Root
			key={toast.id}
			toast={toast}
			className={clsx(
				cardSurface,
				"pointer-events-auto flex min-w-0 items-start gap-3 p-4 text-sm data-[limited]:hidden",
			)}
		>
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
					className={clsx(
						buttonClassName,
						linkClassName,
						"px-1 text-muted text-xs leading-5",
					)}
				>
					Close
				</Toast.Close>
			</div>
		</Toast.Root>
	));
}

/** The viewport floats above the page, so a message never moves the layout. */
export function ToastProvider({ children }: { children: ReactNode }) {
	return (
		<Toast.Provider toastManager={toastManager} limit={3} timeout={5000}>
			{children}
			<Toast.Portal>
				<Toast.Viewport className="pointer-events-none fixed right-4 bottom-4 z-50 flex max-h-[calc(100dvh-2rem)] w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto">
					<ToastList />
				</Toast.Viewport>
			</Toast.Portal>
		</Toast.Provider>
	);
}
