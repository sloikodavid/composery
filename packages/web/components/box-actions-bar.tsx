"use client";

import { EllipsisVertical, ExternalLink } from "lucide-react";
import { useRef, useState } from "react";
import { AnimatedIconAnchor } from "@/components/animated-icon";
import { QrDialog } from "@/components/box-qr-dialog";
import { Button, buttonVariants } from "@/components/button";
import { CopyLinkButton } from "@/components/copy-link-button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger
} from "@/components/dropdown-menu";
import { ScanTextIcon, type ScanTextIconHandle } from "@/components/scan-text";
import { useIsTouch } from "@/hooks/use-is-touch";

// Page-level box actions, beside the breadcrumbs. Shared by the owner and console
// box pages. On touch devices the primary actions are Copy link + Open in app and
// the rest overflow into a kebab (so nothing is made impossible just because the
// row is narrow); on desktop all three sit inline, no kebab needed.
export function BoxActionsBar({ runtimeUrl }: { runtimeUrl: string }) {
	const [qrOpen, setQrOpen] = useState(false);
	const scan = useRef<ScanTextIconHandle>(null);
	const isTouch = useIsTouch();

	const openInApp = `composery://add-instance?url=${encodeURIComponent(runtimeUrl)}`;

	return (
		<>
			{isTouch ? (
				<div className="grid grid-cols-[1fr_1fr_auto] gap-2">
					<CopyLinkButton value={runtimeUrl} />
					<AnimatedIconAnchor
						className={buttonVariants()}
						href={openInApp}
						icon="download"
						iconPosition="start"
					>
						Open in app
					</AnimatedIconAnchor>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button aria-label="More actions" size="icon" variant="outline">
									<EllipsisVertical />
								</Button>
							}
						/>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => setQrOpen(true)}>
								<ScanTextIcon size={16} />
								Show QR
							</DropdownMenuItem>
							{/* "Open box" reads as ambiguous on a phone, so spell out the
							    behaviour: it opens the runtime in a new browser tab. */}
							<DropdownMenuItem
								render={
									<a href={runtimeUrl} rel="noreferrer" target="_blank">
										<ExternalLink />
										Open in new tab
									</a>
								}
							/>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			) : (
				<div className="flex flex-wrap gap-2">
					<CopyLinkButton value={runtimeUrl} />
					<Button
						onClick={() => setQrOpen(true)}
						onMouseEnter={() => scan.current?.startAnimation()}
						onMouseLeave={() => scan.current?.stopAnimation()}
						variant="outline"
					>
						<ScanTextIcon ref={scan} size={16} />
						Show QR
					</Button>
					<AnimatedIconAnchor
						className={buttonVariants()}
						href={runtimeUrl}
						icon="arrow-up-right"
						rel="noreferrer"
						target="_blank"
					>
						Open box
					</AnimatedIconAnchor>
				</div>
			)}
			<QrDialog
				onOpenChange={setQrOpen}
				open={qrOpen}
				runtimeUrl={runtimeUrl}
			/>
		</>
	);
}
