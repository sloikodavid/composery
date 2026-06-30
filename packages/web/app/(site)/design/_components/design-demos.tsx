"use client";

import { EllipsisVertical, ExternalLink, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { AnimatedIconButton } from "@/components/animated-icon";
import { Button } from "@/components/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from "@/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from "@/components/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue
} from "@/components/select";

// Dialog demo: shows the default (compact) and panel (wider) sizes.
export function DialogDemo() {
	const [openDefault, setOpenDefault] = useState(false);
	const [openPanel, setOpenPanel] = useState(false);

	return (
		<div className="flex flex-wrap gap-3">
			<Button onClick={() => setOpenDefault(true)} variant="outline">
				Default size
			</Button>
			<Button onClick={() => setOpenPanel(true)} variant="outline">
				Panel size
			</Button>

			<Dialog onOpenChange={setOpenDefault} open={openDefault}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Default dialog</DialogTitle>
						<DialogDescription>
							Compact dialog for confirmations and short forms. Sizes to its
							content, max-w-md.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline">Close</Button>} />
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog onOpenChange={setOpenPanel} open={openPanel}>
				<DialogContent size="panel">
					<DialogHeader>
						<DialogTitle>Panel dialog</DialogTitle>
						<DialogDescription>
							Wider dialog for richer content (e.g. the snapshots viewer). Sizes
							to its content, max-w-3xl.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline">Close</Button>} />
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

// ConfirmDialog demo: the destructive-action pattern with a render-prop trigger.
export function ConfirmDialogDemo() {
	return (
		<ConfirmDialog
			confirmLabel="Delete"
			description="Permanently removes this item. This can't be undone."
			destructive
			onConfirm={() => {}}
			title="Delete item"
		>
			{(open) => (
				<AnimatedIconButton
					icon="delete"
					iconPosition="start"
					onClick={open}
					variant="destructive"
				>
					Delete item
				</AnimatedIconButton>
			)}
		</ConfirmDialog>
	);
}

// Select demo: dropdown with a few options.
export function SelectDemo() {
	const [value, setValue] = useState("cpu");
	const items: Record<string, string> = {
		cpu: "CPU",
		network_out: "Network out",
		disk_read: "Disk read"
	};

	return (
		<Select
			items={items}
			onValueChange={(next) => setValue(next ?? "cpu")}
			value={value}
		>
			<SelectTrigger className="w-36">
				<SelectValue />
			</SelectTrigger>
			<SelectContent>
				{Object.entries(items).map(([key, label]) => (
					<SelectItem key={key} value={key}>
						{label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

// DropdownMenu demo: overflow menu with items, a label, and a separator.
export function DropdownMenuDemo() {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button aria-label="Menu" size="icon" variant="outline">
						<EllipsisVertical />
					</Button>
				}
			/>
			<DropdownMenuContent align="end">
				<DropdownMenuGroup>
					<DropdownMenuLabel>Actions</DropdownMenuLabel>
					<DropdownMenuItem
						render={
							<a href="#" rel="noreferrer" target="_blank">
								<ExternalLink />
								Open
							</a>
						}
					/>
					<DropdownMenuItem onClick={() => {}}>Edit</DropdownMenuItem>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem variant="destructive" onClick={() => {}}>
					<Trash2Icon />
					Delete
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

// Animated icons demo: all registered animated icons on buttons and anchors.
const ANIMATED_ICON_NAMES = [
	"arrow-right",
	"arrow-up-right",
	"construction",
	"copy",
	"credit-card",
	"delete",
	"download",
	"layout-grid",
	"lock",
	"login",
	"pen-tool",
	"play",
	"plus",
	"rotate-cw",
	"square-pen",
	"wallet",
	"washing-machine"
] as const;

export function AnimatedIconsDemo() {
	return (
		<div className="flex flex-wrap gap-2">
			{ANIMATED_ICON_NAMES.map((name) => (
				<AnimatedIconButton
					icon={name}
					iconPosition="start"
					key={name}
					onClick={() => {}}
					size="sm"
					variant="outline"
				>
					{name}
				</AnimatedIconButton>
			))}
		</div>
	);
}

export function AnimatedIconOnlyDemo() {
	return (
		<div className="flex flex-wrap gap-2">
			{ANIMATED_ICON_NAMES.map((name) => (
				<AnimatedIconButton
					aria-label={name}
					icon={name}
					iconPosition="only"
					key={name}
					onClick={() => {}}
					size="icon-sm"
					variant="outline"
				/>
			))}
		</div>
	);
}
