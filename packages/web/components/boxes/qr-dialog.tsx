"use client";

import { QRCodeSVG } from "qrcode.react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle
} from "@/components/base/dialog";

// QR of the box URL, for opening the box on a phone. The code sits on a fixed
// white card and carries the spec's four-module quiet zone so it stays scannable
// regardless of theme, and shrinks with the dialog on narrow screens.
export function QrDialog({
	runtimeUrl,
	open,
	onOpenChange
}: {
	runtimeUrl: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Scan to open on your phone</DialogTitle>
					<DialogDescription>
						Scan with your phone&apos;s camera to open this box in the browser.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col items-center gap-4 py-2">
					<div className="max-w-full rounded-xl bg-white p-4">
						<QRCodeSVG
							className="h-auto w-full max-w-[232px]"
							level="M"
							marginSize={4}
							size={232}
							title={`QR code for ${runtimeUrl}`}
							value={runtimeUrl}
						/>
					</div>
					<span className="break-all text-center text-muted-foreground text-sm">
						{runtimeUrl}
					</span>
				</div>
			</DialogContent>
		</Dialog>
	);
}
