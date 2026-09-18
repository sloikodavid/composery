import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ToastDemo } from "@/app/primitives/toast-demo";
import { Glow } from "@/components/brand/glow";
import { Logo } from "@/components/brand/logo";
import { Wordmark } from "@/components/brand/wordmark";
import {
	Button,
	type ButtonSize,
	type ButtonVariant,
	buttonSizes,
	buttonVariants,
} from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { InputField } from "@/components/ui/input-field";
import { Link } from "@/components/ui/link";
import { Table } from "@/components/ui/table";

export const metadata: Metadata = {
	title: "Primitives · Composery",
	robots: { index: false, follow: false },
};

const variants = Object.keys(buttonVariants) as ButtonVariant[];
const sizes = Object.keys(buttonSizes) as ButtonSize[];

const colors = [
	["background", "bg-background"],
	["foreground", "bg-foreground"],
	["muted", "bg-muted"],
	["mutedSurface", "bg-muted-surface"],
	["border", "bg-border"],
	["controlBorder", "bg-control-border"],
	["focus", "bg-focus"],
	["surface", "bg-surface"],
	["splitPanelContent", "bg-split-panel-content"],
	["splitPanelNavigation", "bg-split-panel-navigation"],
	["primary", "bg-primary"],
	["danger", "bg-danger"],
	["brand", "bg-brand"],
] as const;

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
			<h2 className="font-brand text-muted text-xs uppercase tracking-label">
				{title}
			</h2>
			{children}
		</section>
	);
}

function Caption({ children }: { children: ReactNode }) {
	return <span className="w-20 shrink-0 text-muted text-xs">{children}</span>;
}

/** Every primitive in every variant, for design review during development. */
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
				</Section>

				<Section title="Link">
					<div className="flex flex-wrap items-center gap-6">
						<Link href="/privacy">Privacy</Link>
						<Link href="/terms">Terms</Link>
					</div>
				</Section>

				<Section title="Input">
					<div className="grid max-w-2xl gap-5 sm:grid-cols-2">
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
						<p className="font-brand text-xs uppercase tracking-label">
							Label · 2 vCPU · 4 GB
						</p>
					</div>
				</Section>

				<Section title="Color">
					<div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:grid-cols-11">
						{colors.map(([name, className]) => (
							<div key={name} className="flex flex-col gap-2">
								<div className={`h-16 border border-border ${className}`} />
								<span className="text-xs">{name}</span>
							</div>
						))}
					</div>
				</Section>

				<Section title="Card">
					<Card>Content on a card.</Card>
				</Section>

				<Section title="Container">
					<div className="border border-border py-4">
						<Container width="narrow">
							<div className="bg-muted-surface p-3 text-sm">
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
