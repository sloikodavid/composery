"use client";

import { toast } from "sonner";
import { Button } from "@/components/button";

export function ToastDemo() {
	return (
		<div className="flex flex-wrap gap-3">
			<Button
				onClick={() =>
					toast.success("Saved", {
						description: "Your changes were saved."
					})
				}
				variant="outline"
			>
				Success
			</Button>
			<Button
				onClick={() =>
					toast.info("Heads up", {
						description: "This is an informational message."
					})
				}
				variant="outline"
			>
				Info
			</Button>
			<Button
				onClick={() =>
					toast.warning("Careful", {
						description: "This action needs your attention."
					})
				}
				variant="outline"
			>
				Warning
			</Button>
			<Button
				onClick={() =>
					toast.error("Something went wrong", {
						description: "We couldn't complete that. Try again."
					})
				}
				variant="outline"
			>
				Error
			</Button>
		</div>
	);
}
