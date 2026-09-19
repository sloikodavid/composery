import { IconPlus } from "@tabler/icons-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ToastDemo } from "@/app/primitives/toast-demo";
import { Glow } from "@/components/brand/glow";
import { Logo } from "@/components/brand/logo";
import { Wordmark } from "@/components/brand/wordmark";
import { Alert, type AlertVariant } from "@/components/ui/alert";
import { Avatar } from "@/components/ui/avatar";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import {
	Button,
	type ButtonSize,
	type ButtonVariant,
	buttonSizes,
	buttonVariants,
} from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Container } from "@/components/ui/container";
import {
	Field,
	FieldDescription,
	FieldLabel,
	FieldMessage,
} from "@/components/ui/field";
import { Textarea } from "@/components/ui/input";
import { InputField } from "@/components/ui/input-field";
import { InputGroup } from "@/components/ui/input-group";
import { Link } from "@/components/ui/link";
import { RadioGroup } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table } from "@/components/ui/table";

export const metadata: Metadata = {
	title: "Primitives · Composery",
	robots: { index: false, follow: false },
};

const variants = Object.keys(buttonVariants) as ButtonVariant[];
const sizes = Object.keys(buttonSizes) as ButtonSize[];
const badgeVariants: BadgeVariant[] = [
	"neutral",
	"primary",
	"success",
	"warning",
	"danger",
];
const alertVariants: AlertVariant[] = [
	"neutral",
	"success",
	"warning",
	"danger",
];

const tableColumns = [
	{ id: "name", href: "/?sort=name", text: "Name" },
	{ id: "status", href: "/?sort=status", text: "Status" },
	{ id: "address", href: "/?sort=address", text: "Address" },
] as const;

const tableRows = [
	{
		id: "developmentServer",
		href: "/",
		cells: ["Development server", "Running", "192.0.2.10"],
	},
	{
		id: "personalServer",
		href: "/",
		cells: ["Personal server", "Stopped", "192.0.2.20"],
	},
] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-5 border-border border-t py-10">
			<h2 className="font-brand text-muted text-sm tracking-display">
				{title}
			</h2>
			{children}
		</section>
	);
}

function Caption({ children }: { children: ReactNode }) {
	return <span className="w-20 shrink-0 text-muted text-xs">{children}</span>;
}

export default function PrimitivesPage() {
	if (process.env.NODE_ENV === "production") {
		notFound();
	}

	return (
		<main className="flex-1">
			<Container className="py-10">
				<header className="pb-10">
					<h1 className="text-4xl">Primitives</h1>
				</header>

				<Section title="Button">
					{sizes.map((size) => (
						<div key={size} className="flex flex-wrap items-center gap-3">
							<Caption>{size}</Caption>
							{variants.map((variant) => (
								<Button key={variant} variant={variant} size={size}>
									{variant}
								</Button>
							))}
						</div>
					))}
					<div className="flex flex-wrap items-center gap-3">
						<Caption>disabled</Caption>
						{variants.map((variant) => (
							<Button key={variant} variant={variant} disabled>
								{variant}
							</Button>
						))}
					</div>
					<div className="flex flex-wrap items-center gap-3">
						<Caption>icon only</Caption>
						{variants.map((variant) => (
							<Button
								key={variant}
								aria-label="Add server"
								iconOnly
								variant={variant}
							>
								<IconPlus aria-hidden="true" />
							</Button>
						))}
					</div>
				</Section>

				<Section title="Link">
					<div className="flex flex-wrap items-center gap-6">
						<Link href="/privacy">Privacy</Link>
						<Link href="/terms">Terms</Link>
					</div>
				</Section>

				<Section title="Input">
					<div className="grid max-w-md gap-5">
						<InputField
							id="defaultInput"
							label="Default"
							placeholder="Server name"
						/>
						<InputField
							id="valueInput"
							label="Value"
							defaultValue="Development server"
						/>
						<InputField
							id="disabledInput"
							label="Disabled"
							disabled
							defaultValue="Unavailable"
						/>
						<InputField
							id="invalidInput"
							label="Invalid"
							error="Use letters, numbers, or hyphens."
							defaultValue="Invalid name"
						/>
					</div>
				</Section>

				<Section title="Textarea">
					<div className="grid max-w-2xl gap-5 sm:grid-cols-2">
						<Field>
							<FieldLabel htmlFor="defaultTextarea">Default</FieldLabel>
							<Textarea id="defaultTextarea" placeholder="Server notes" />
							<FieldMessage reserveSpace />
						</Field>
						<Field>
							<FieldLabel htmlFor="invalidTextarea">Invalid</FieldLabel>
							<Textarea
								id="invalidTextarea"
								aria-invalid="true"
								defaultValue="Too much text"
							/>
							<FieldMessage reserveSpace variant="error">
								Keep the note under 500 characters.
							</FieldMessage>
						</Field>
					</div>
				</Section>

				<Section title="Input group">
					<div className="grid max-w-md gap-5">
						<Field>
							<FieldLabel htmlFor="domainInput">Domain</FieldLabel>
							<InputGroup
								id="domainInput"
								prefix="https://"
								suffix=".example.com"
								defaultValue="server"
							/>
							<FieldDescription>
								Prefix and suffix share one frame.
							</FieldDescription>
						</Field>
						<Field>
							<FieldLabel htmlFor="disabledGroup">Disabled</FieldLabel>
							<InputGroup
								id="disabledGroup"
								disabled
								prefix="ssh"
								defaultValue="Unavailable"
							/>
						</Field>
					</div>
				</Section>

				<Section title="Checkbox">
					<div className="grid max-w-2xl gap-5 sm:grid-cols-2">
						<Checkbox
							id="checkedCheckbox"
							label="Automatic updates"
							description="Install supported updates automatically."
							defaultChecked
						/>
						<Checkbox
							id="disabledCheckbox"
							label="Unavailable setting"
							disabled
						/>
					</div>
				</Section>

				<Section title="Radio group">
					<div className="max-w-md">
						<RadioGroup
							label="Server size"
							name="serverSize"
							defaultValue="standard"
							options={[
								{
									value: "standard",
									label: "Standard",
									description: "2 vCPU and 4 GB RAM",
								},
								{
									value: "large",
									label: "Large",
									description: "4 vCPU and 8 GB RAM",
								},
								{ value: "unavailable", label: "Unavailable", disabled: true },
							]}
						/>
					</div>
				</Section>

				<Section title="Switch">
					<div className="flex flex-wrap gap-6">
						<Switch label="Stopped" />
						<Switch label="Running" defaultChecked />
						<Switch label="Disabled" disabled />
					</div>
				</Section>

				<Section title="Badge">
					<div className="flex flex-wrap gap-3">
						{badgeVariants.map((variant) => (
							<Badge key={variant} variant={variant}>
								{variant}
							</Badge>
						))}
					</div>
				</Section>

				<Section title="Avatar">
					<div className="flex flex-wrap items-center gap-4">
						<Avatar alt="David Sloiko" fallback="DS" size="small" />
						<Avatar alt="David Sloiko" fallback="DS" size="medium" />
						<Avatar alt="David Sloiko" fallback="DS" size="large" />
					</div>
				</Section>

				<Section title="Alert">
					<div className="grid max-w-2xl gap-3">
						{alertVariants.map((variant) => (
							<Alert
								key={variant}
								variant={variant}
								title={`${variant} alert`}
								description="This message stays inside the page layout."
							/>
						))}
					</div>
				</Section>

				<Section title="Spinner">
					<div className="flex flex-wrap items-center gap-5">
						<Spinner size="extraSmall" />
						<Spinner size="small" />
						<Spinner size="medium" />
						<Spinner size="large" variant="primary" />
					</div>
				</Section>

				<Section title="Logo">
					<div className="flex flex-wrap items-end gap-x-12 gap-y-6">
						{(["text-sm", "text-xl", "text-4xl", "text-7xl"] as const).map(
							(size) => (
								<div key={size} className="flex flex-col gap-2">
									<Logo className={size} />
									<Caption>{size}</Caption>
								</div>
							),
						)}
					</div>
				</Section>

				<Section title="Wordmark">
					<Wordmark className="text-6xl" />
				</Section>

				<Section title="Type">
					<div className="flex flex-col gap-4">
						<h1 className="text-5xl">Heading 1</h1>
						<h2 className="text-3xl">Heading 2</h2>
						<h3 className="text-xl">Heading 3</h3>
						<p className="max-w-prose">
							Body text uses Onest at weight 350. It is for everything people
							read.
						</p>
						<p className="max-w-prose text-muted text-sm">
							Muted text is for help and secondary details.
						</p>
						<p className="font-brand text-sm tracking-display">
							Label · 2 vCPU · 4 GB
						</p>
					</div>
				</Section>

				<Section title="Card">
					<Card>Content on a card.</Card>
				</Section>

				<Section title="Container">
					<div className="overflow-hidden rounded-panel border border-border py-4">
						<Container width="narrow">
							<div className="rounded-control bg-muted-surface p-3 text-sm">
								Narrow container
							</div>
						</Container>
					</div>
				</Section>

				<Section title="Table">
					<Table
						columns={tableColumns}
						label="Example servers"
						rows={tableRows}
					/>
				</Section>

				<Section title="Toast">
					<div className="flex">
						<ToastDemo />
					</div>
				</Section>

				<Section title="Glow">
					<Glow className="relative h-80 border border-border" />
				</Section>
			</Container>
		</main>
	);
}
