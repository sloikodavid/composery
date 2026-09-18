"use client";

import { Button } from "@/components/ui/button";
import { toastManager } from "@/components/ui/toast";

export function ToastDemo() {
	function showToast() {
		toastManager.add({
			title: "Server created",
			description: "The server is ready.",
		});
	}

	return (
		<Button variant="secondary" onClick={showToast}>
			Show toast
		</Button>
	);
}
