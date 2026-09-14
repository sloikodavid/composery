"use client";

import { Toast } from "@base-ui/react/toast";
import type { ReactNode } from "react";

/** Adds a floating message for a transient outcome, from any code on the client. */
export const toastManager = Toast.createToastManager();

function ToastList() {
	const { toasts } = Toast.useToastManager();
	return toasts.map((toast) => (
		<Toast.Root
			key={toast.id}
			toast={toast}
			className="flex items-start gap-3 border border-border bg-surface p-4 text-sm shadow-lg"
		>
			<div className="flex flex-1 flex-col gap-1">
				<Toast.Title className="font-brand text-foreground" />
				<Toast.Description className="text-muted" />
			</div>
			<Toast.Close className="font-brand text-muted text-xs transition-colors hover:text-foreground">
				Close
			</Toast.Close>
		</Toast.Root>
	));
}

// The viewport floats above the page, so a message never moves the layout.
export function ToastProvider({ children }: { children: ReactNode }) {
	return (
		<Toast.Provider toastManager={toastManager}>
			{children}
			<Toast.Portal>
				<Toast.Viewport className="fixed right-4 bottom-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
					<ToastList />
				</Toast.Viewport>
			</Toast.Portal>
		</Toast.Provider>
	);
}
