import {
	BoxIcon,
	CheckIcon,
	ChevronRightIcon,
	CircleAlertIcon,
	InfoIcon,
	PenToolIcon,
	SettingsIcon,
	TriangleAlertIcon,
	XIcon
} from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LogoExport } from "./_components/logo-export";
import { LogoShowcase } from "./_components/logo-showcase";
import {
	AnimatedIconsDemo,
	AnimatedIconOnlyDemo,
	ConfirmDialogDemo,
	DialogDemo,
	DropdownMenuDemo,
	SelectDemo
} from "./_components/design-demos";
import { ToastDemo } from "./_components/toast-demo";
import { PageTemplate } from "@/components/page-template";
import { StatusText } from "@/components/status-text";
import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { Card, CardContent } from "@/components/card";
import { CopyLinkButton } from "@/components/copy-link-button";
import { Input } from "@/components/input";
import { Label } from "@/components/label";
import { Separator } from "@/components/separator";
import { Skeleton } from "@/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableEmptyRow,
	TableHead,
	TableHeader,
	TableLoadingRow,
	TableRow
} from "@/components/table";
import { Textarea } from "@/components/textarea";
import { notFoundIfNotStaff } from "@/lib/route-guards";

export const metadata: Metadata = {
	title: "Design",
	robots: { index: false, follow: false }
};

// Distinct theme surfaces and accents. The flat Umber theme collapses --card
// onto --background and --accent/--secondary onto --muted, so those are omitted
// here rather than shown as duplicate swatches.
const colorTokens = [
	"--background",
	"--foreground",
	"--muted",
	"--border",
	"--primary",
	"--success",
	"--warning",
	"--destructive",
	"--ring"
];

const icons = [
	{ Icon: CheckIcon, name: "check" },
	{ Icon: CircleAlertIcon, name: "circle-alert" },
	{ Icon: InfoIcon, name: "info" },
	{ Icon: TriangleAlertIcon, name: "triangle-alert" },
	{ Icon: BoxIcon, name: "box" },
	{ Icon: SettingsIcon, name: "settings" },
	{ Icon: ChevronRightIcon, name: "chevron-right" },
	{ Icon: XIcon, name: "x" }
];

// Every status the UI can show, grouped by source so the full palette is
// visible at a glance.
const STATUS_GROUPS: { label: string; statuses: string[] }[] = [
	{
		label: "Box lifecycle",
		statuses: [
			"provisioning",
			"running",
			"provisioning_failed",
			"stopping",
			"stopped",
			"starting",
			"resetting",
			"reset_failed",
			"restoring",
			"restore_failed",
			"suspending",
			"suspended",
			"unsuspending",
			"deleting",
			"delete_failed",
			"deleted"
		]
	},
	{
		label: "Operations",
		statuses: ["pending", "running", "succeeded", "failed"]
	},
	{
		label: "Snapshots",
		statuses: ["pending", "creating", "complete", "failed", "deleting"]
	},
	{
		label: "External (Polar)",
		statuses: [
			"active",
			"open",
			"confirmed",
			"converted",
			"expired",
			"released"
		]
	}
];

const TABLE_ROWS = [
	{ name: "alpha", status: "running", created: "2026-06-01" },
	{ name: "beta", status: "stopped", created: "2026-06-15" },
	{ name: "gamma", status: "suspended", created: "2026-06-28" }
];

function Section({
	children,
	note,
	title
}: {
	children: ReactNode;
	note?: string;
	title: string;
}) {
	return (
		<section className="space-y-3">
			<div className="space-y-1">
				<h2 className="text-sm font-medium text-foreground">{title}</h2>
				{note ? (
					<p className="text-sm leading-6 text-muted-foreground">{note}</p>
				) : null}
			</div>
			<Card>
				<CardContent>{children}</CardContent>
			</Card>
		</section>
	);
}

export default async function DesignPage() {
	await notFoundIfNotStaff();

	return (
		<PageTemplate breadcrumbs={[{ icon: PenToolIcon, label: "Design" }]}>
			<div className="space-y-8">
				<Section
					note="The Composery logo: the icon mark with the Bricolage Grotesque font for the text."
					title="Logo"
				>
					<div className="space-y-5">
						<LogoShowcase />
						<LogoExport />
					</div>
				</Section>

				<Section
					note="Static lucide-react glyphs for status, sorting, loading, and informational use. Interactive buttons and links use the animated variants below."
					title="Icons (static)"
				>
					<div className="flex flex-wrap gap-4">
						{icons.map(({ Icon, name }) => (
							<div className="flex items-center gap-2" key={name}>
								<Icon className="size-4 text-foreground" />
								<span className="text-xs text-muted-foreground">{name}</span>
							</div>
						))}
					</div>
				</Section>

				<Section
					note="@lucide-animated icons wired through components/animated-icon. The whole target starts the animation on hover or focus. Used on every interactive button and link."
					title="Animated icons"
				>
					<div className="space-y-4">
						<div className="space-y-1.5">
							<p className="text-xs text-muted-foreground">With label</p>
							<AnimatedIconsDemo />
						</div>
						<Separator />
						<div className="space-y-1.5">
							<p className="text-xs text-muted-foreground">Icon only</p>
							<AnimatedIconOnlyDemo />
						</div>
					</div>
				</Section>

				<Section title="Button">
					<div className="space-y-4">
						<div className="flex flex-wrap items-center gap-3">
							<Button>Default</Button>
							<Button variant="outline">Outline</Button>
							<Button variant="secondary">Secondary</Button>
							<Button variant="ghost">Ghost</Button>
							<Button variant="destructive">Destructive</Button>
							<Button variant="link">Link</Button>
						</div>
						<Separator />
						<div className="flex flex-wrap items-center gap-3">
							<Button size="sm">Small</Button>
							<Button>Default</Button>
							<Button size="lg">Large</Button>
							<Button disabled>Disabled</Button>
							<Button size="icon" variant="outline">
								<SettingsIcon />
							</Button>
							<Button size="icon-sm" variant="outline">
								<SettingsIcon />
							</Button>
						</div>
					</div>
				</Section>

				<Section
					note="Two variants: outline (border + solid background) and secondary (translucent fill, no border). Default is outline."
					title="Input"
				>
					<div className="grid gap-3 sm:max-w-sm">
						<div className="space-y-1.5">
							<Label htmlFor="demo-input-outline">Outline</Label>
							<Input id="demo-input-outline" placeholder="Type here" />
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="demo-input-secondary">Secondary</Label>
							<Input
								id="demo-input-secondary"
								placeholder="Type here"
								variant="secondary"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="demo-input-disabled">Disabled</Label>
							<Input disabled id="demo-input-disabled" placeholder="Disabled" />
						</div>
					</div>
				</Section>

				<Section
					note="Two variants matching Input: outline and secondary. Default is outline."
					title="Textarea"
				>
					<div className="grid gap-3 sm:max-w-sm">
						<div className="space-y-1.5">
							<Label htmlFor="demo-textarea-outline">Outline</Label>
							<Textarea
								id="demo-textarea-outline"
								placeholder="Multi-line text"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="demo-textarea-secondary">Secondary</Label>
							<Textarea
								id="demo-textarea-secondary"
								placeholder="Multi-line text"
								variant="secondary"
							/>
						</div>
					</div>
				</Section>

				<Section
					note="Dropdown select. Opens below the trigger like a plain dropdown."
					title="Select"
				>
					<SelectDemo />
				</Section>

				<Section title="Copy link">
					<CopyLinkButton value="https://example.com" />
				</Section>

				<Section
					note="Confirmation step for destructive actions. The trigger is a render prop so callers keep full control of the button."
					title="Confirm dialog"
				>
					<ConfirmDialogDemo />
				</Section>

				<Section
					note="default is compact (max-w-md) for confirmations and short forms. panel is wider (max-w-3xl) for richer content like the snapshots viewer. Nested dialogs layer with a darker backdrop."
					title="Dialog"
				>
					<DialogDemo />
				</Section>

				<Section
					note="Overflow / context menu. Items can be default or destructive; labels and separators group actions."
					title="Dropdown menu"
				>
					<DropdownMenuDemo />
				</Section>

				<Section
					note="Card-table pattern used on every data page: rounded-2xl border bg-card container, table-fixed with min-w, h-14 rows, loading and empty states."
					title="Table"
				>
					<div className="space-y-4">
						<div className="overflow-hidden rounded-2xl border border-border bg-card">
							<Table className="table-fixed min-w-[28rem]">
								<TableHeader>
									<TableRow>
										<TableHead className="pl-4">Name</TableHead>
										<TableHead className="w-32">Status</TableHead>
										<TableHead className="w-28">Created</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{TABLE_ROWS.map((row) => (
										<TableRow className="h-14" key={row.name}>
											<TableCell className="pl-4 font-medium text-foreground">
												{row.name}
											</TableCell>
											<TableCell>
												<StatusText status={row.status} />
											</TableCell>
											<TableCell className="text-muted-foreground">
												{row.created}
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>

						<div className="space-y-1.5">
							<p className="text-xs text-muted-foreground">Loading state</p>
							<div className="overflow-hidden rounded-2xl border border-border bg-card">
								<Table className="table-fixed min-w-[28rem]">
									<TableHeader>
										<TableRow>
											<TableHead className="pl-4">Name</TableHead>
											<TableHead className="w-32">Status</TableHead>
											<TableHead className="w-28">Created</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										<TableLoadingRow span={3} />
									</TableBody>
								</Table>
							</div>
						</div>

						<div className="space-y-1.5">
							<p className="text-xs text-muted-foreground">Empty state</p>
							<div className="overflow-hidden rounded-2xl border border-border bg-card">
								<Table className="table-fixed min-w-[28rem]">
									<TableHeader>
										<TableRow>
											<TableHead className="pl-4">Name</TableHead>
											<TableHead className="w-32">Status</TableHead>
											<TableHead className="w-28">Created</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										<TableEmptyRow span={3}>No rows.</TableEmptyRow>
									</TableBody>
								</Table>
							</div>
						</div>
					</div>
				</Section>

				<Section
					note="One design system for every status the UI can show: icon + colored text, no chip background. Tones: success (green), warning (amber), danger (red), neutral (gray). Spinning statuses animate their icon. Unknown statuses fall back to neutral."
					title="Status text"
				>
					<div className="space-y-4">
						{STATUS_GROUPS.map((group) => (
							<div className="space-y-1.5" key={group.label}>
								<p className="text-xs text-muted-foreground">{group.label}</p>
								<div className="flex flex-wrap gap-x-6 gap-y-2">
									{group.statuses.map((status) => (
										<StatusText key={status} status={status} />
									))}
								</div>
							</div>
						))}
					</div>
				</Section>

				<Section
					note="Pill-shaped label. Currently unused in production (replaced by StatusText); kept here for reference."
					title="Badge"
				>
					<div className="flex flex-wrap items-center gap-3">
						<Badge>Default</Badge>
						<Badge variant="secondary">Secondary</Badge>
						<Badge variant="outline">Outline</Badge>
						<Badge variant="destructive">Destructive</Badge>
					</div>
				</Section>

				<Section
					note="Transient feedback via sonner. Auto-dismisses and stacks in the bottom-right."
					title="Toast"
				>
					<ToastDemo />
				</Section>

				<Section title="Card">
					<p className="text-sm leading-6 text-muted-foreground">
						Cards frame a concrete item or form with a soft ring and the card
						surface. This text sits inside one.
					</p>
				</Section>

				<Section title="Separator">
					<div className="space-y-3">
						<p className="text-sm text-muted-foreground">Above</p>
						<Separator />
						<p className="text-sm text-muted-foreground">Below</p>
					</div>
				</Section>

				<Section title="Skeleton">
					<div className="space-y-3">
						<Skeleton className="h-4 w-48" />
						<Skeleton className="h-4 w-32" />
						<Skeleton className="h-20 w-full" />
					</div>
				</Section>

				<Section title="Color tokens">
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
						{colorTokens.map((token) => (
							<div className="flex items-center gap-2" key={token}>
								<span
									className="inline-block size-6 shrink-0 rounded-md border border-border"
									style={{ background: `var(${token})` }}
								/>
								<span className="text-xs text-muted-foreground">{token}</span>
							</div>
						))}
					</div>
				</Section>
			</div>
		</PageTemplate>
	);
}
