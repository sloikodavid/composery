import type { ReactNode } from "react";
import { usePairing } from "./pairing-context";
import { SpecimenLockup } from "./specimen-lockup";
import { tones } from "./specimen-tones";

function Logo({ size }: { size: number }) {
	const { displayFont, logoSettings } = usePairing();
	return (
		<SpecimenLockup
			font={displayFont}
			settings={logoSettings}
			axisValues={{}}
			size={size}
		/>
	);
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "small" | "medium" | "large";

const buttonVariants: Record<ButtonVariant, string> = {
	primary: tones.inverse,
	secondary: `border ${tones.strongBorder} ${tones.text}`,
	ghost: tones.text,
	danger: `border ${tones.dangerBorder} ${tones.danger}`,
};

const buttonSizes: Record<ButtonSize, string> = {
	small: "h-8 px-3 text-[13px]",
	medium: "h-9 px-4 text-sm",
	large: "h-11 px-5 text-base",
};

function Button({
	variant = "primary",
	size = "medium",
	disabled = false,
	children,
}: {
	variant?: ButtonVariant;
	size?: ButtonSize;
	disabled?: boolean;
	children: ReactNode;
}) {
	const { display } = usePairing();
	return (
		<button
			type="button"
			disabled={disabled}
			className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap disabled:opacity-40 ${buttonVariants[variant]} ${buttonSizes[size]}`}
			style={display}
		>
			{children}
		</button>
	);
}

type Status = "online" | "starting" | "stopped" | "failed";

const statusDots: Record<Status, string> = {
	online: "bg-emerald-500",
	starting: "bg-amber-500",
	stopped: "bg-neutral-400",
	failed: "bg-red-500",
};

function StatusBadge({ status }: { status: Status }) {
	const { label } = usePairing();
	return (
		<span
			className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] ${tones.sunken} ${tones.text}`}
			style={label}
		>
			<span aria-hidden="true" className={`size-1.5 ${statusDots[status]}`} />
			{status}
		</span>
	);
}

function Label({ children }: { children: ReactNode }) {
	const { label } = usePairing();
	return (
		<span className={`text-xs ${tones.muted}`} style={label}>
			{children}
		</span>
	);
}

function Heading({
	level,
	children,
}: {
	level: 1 | 2 | 3;
	children: ReactNode;
}) {
	const { heading } = usePairing();
	const size = { 1: "text-5xl leading-[1.05]", 2: "text-2xl", 3: "text-lg" }[
		level
	];
	const Tag = level === 1 ? "h2" : level === 2 ? "h3" : "h4";
	return (
		<Tag className={`${size} ${tones.text}`} style={heading}>
			{children}
		</Tag>
	);
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
	const { body } = usePairing();
	return (
		<figure className="flex min-w-0 flex-col gap-2">
			<figcaption
				className={`font-sans text-[11px] uppercase tracking-wide ${tones.faint}`}
			>
				{title}
			</figcaption>
			<div
				className={`min-w-0 overflow-x-auto border ${tones.border} ${tones.surface} ${tones.text}`}
				style={body}
			>
				{children}
			</div>
		</figure>
	);
}

function TextInput({
	id,
	label,
	value,
	placeholder,
	help,
	error,
}: {
	id: string;
	label: string;
	value?: string;
	placeholder?: string;
	help?: string;
	error?: string;
}) {
	const { strong } = usePairing();
	return (
		<div className="flex flex-col gap-1.5">
			<label htmlFor={id} className="text-sm" style={strong}>
				{label}
			</label>
			<input
				id={id}
				defaultValue={value}
				placeholder={placeholder}
				aria-invalid={error ? true : undefined}
				className={`h-9 border px-3 text-sm ${tones.surface} ${
					error ? tones.dangerBorder : tones.strongBorder
				}`}
			/>
			{/* The message line is always present, so an error does not move the form. */}
			<p className={`min-h-4 text-xs ${error ? tones.danger : tones.muted}`}>
				{error ?? help}
			</p>
		</div>
	);
}

function HeroScreen() {
	const { body } = usePairing();
	return (
		<Frame title="Landing page">
			<div className="flex flex-col">
				<nav
					className={`flex items-center justify-between gap-4 border-b px-6 py-3 ${tones.border}`}
				>
					<Logo size={18} />
					<div className={`hidden gap-6 text-sm sm:flex ${tones.muted}`}>
						<span>How it works</span>
						<span>Pricing</span>
						<span>Docs</span>
					</div>
					<Button size="small">Sign in</Button>
				</nav>
				<div className="flex flex-col items-start gap-5 px-6 py-14">
					<Label>Personal compute</Label>
					<Heading level={1}>A server your AI assistant can build on.</Heading>
					<p
						className={`max-w-xl text-lg leading-relaxed ${tones.muted}`}
						style={body}
					>
						Build apps, store files, and run automations. Connect Claude,
						ChatGPT, or Codex in one step. No SSH needed.
					</p>
					<div className="flex flex-wrap gap-3">
						<Button size="large">Create a server</Button>
						<Button size="large" variant="secondary">
							See how it works
						</Button>
					</div>
					<p className={`text-sm ${tones.faint}`}>
						Works with Claude · ChatGPT · Codex · any MCP client
					</p>
				</div>
			</div>
		</Frame>
	);
}

const servers = [
	{
		name: "studio",
		status: "online",
		specs: "2 vCPU · 4 GB · 40 GB",
		apps: 6,
		region: "Nuremberg",
	},
	{
		name: "client-acme",
		status: "starting",
		specs: "4 vCPU · 8 GB · 80 GB",
		apps: 2,
		region: "Helsinki",
	},
	{
		name: "archive",
		status: "stopped",
		specs: "2 vCPU · 2 GB · 40 GB",
		apps: 0,
		region: "Ashburn",
	},
	{
		name: "scraper",
		status: "failed",
		specs: "2 vCPU · 4 GB · 40 GB",
		apps: 1,
		region: "Nuremberg",
	},
] as const satisfies readonly {
	name: string;
	status: Status;
	specs: string;
	apps: number;
	region: string;
}[];

function DashboardScreen() {
	const { display, strong } = usePairing();
	return (
		<Frame title="Dashboard">
			<div className="flex min-w-[40rem]">
				<aside
					className={`flex w-44 shrink-0 flex-col gap-1 border-r p-4 text-sm ${tones.border}`}
				>
					<div className="mb-4">
						<Logo size={16} />
					</div>
					{[
						"Servers",
						"Apps",
						"Files",
						"Automations",
						"Assistants",
						"Settings",
					].map((item, index) => (
						<span
							key={item}
							className={`px-2 py-1.5 ${index === 0 ? `${tones.sunken} ${tones.text}` : tones.muted}`}
							style={index === 0 ? strong : undefined}
						>
							{item}
						</span>
					))}
				</aside>
				<div className="flex min-w-0 flex-1 flex-col gap-5 p-6">
					<div className="flex items-center justify-between gap-4">
						<Heading level={2}>Servers</Heading>
						<Button>Create server</Button>
					</div>
					<ul className="grid grid-cols-2 gap-3">
						{servers.map((server) => (
							<li
								key={server.name}
								className={`flex flex-col gap-3 border p-4 ${tones.border}`}
							>
								<div className="flex items-center justify-between gap-2">
									<span className="text-base" style={strong}>
										{server.name}
									</span>
									<StatusBadge status={server.status} />
								</div>
								<span
									className={`text-sm tabular-nums ${tones.muted}`}
									style={display}
								>
									{server.specs}
								</span>
								<span className={`text-xs ${tones.faint}`}>
									{server.apps} {server.apps === 1 ? "app" : "apps"} ·{" "}
									{server.region}
								</span>
							</li>
						))}
					</ul>
				</div>
			</div>
		</Frame>
	);
}

const plans = [
	{ name: "Small", specs: "2 vCPU · 4 GB · 40 GB", price: "$6" },
	{ name: "Medium", specs: "4 vCPU · 8 GB · 80 GB", price: "$14" },
	{ name: "Large", specs: "8 vCPU · 16 GB · 160 GB", price: "$29" },
] as const;

function CreateServerScreen() {
	const { display, label, strong } = usePairing();
	return (
		<Frame title="Form">
			<div className="flex flex-col gap-5 p-6">
				<Heading level={2}>Create a server</Heading>
				<TextInput
					id="pairing-name"
					label="Name"
					value="studio"
					help="Use lowercase letters, numbers, and hyphens."
				/>
				<TextInput
					id="pairing-name-taken"
					label="Name"
					value="archive"
					error="This name is not available."
				/>
				<fieldset className="flex flex-col gap-2">
					<legend className="mb-1.5 text-sm" style={strong}>
						Size
					</legend>
					<div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
						{plans.map((plan, index) => (
							<label
								key={plan.name}
								className={`flex cursor-pointer flex-col gap-1 border p-3 ${
									index === 0 ? "border-current" : tones.strongBorder
								}`}
							>
								<span className="flex items-center justify-between">
									<span className="text-xs" style={label}>
										{plan.name}
									</span>
									<input
										type="radio"
										name="pairing-size"
										defaultChecked={index === 0}
									/>
								</span>
								<span className="text-xl tabular-nums" style={display}>
									{plan.price}
									<span className={`text-xs ${tones.faint}`}> / month</span>
								</span>
								<span className={`text-xs tabular-nums ${tones.muted}`}>
									{plan.specs}
								</span>
							</label>
						))}
					</div>
				</fieldset>
				<details className={`border ${tones.border}`} open>
					<summary className="cursor-pointer px-3 py-2 text-sm" style={strong}>
						Advanced
					</summary>
					<div className={`flex flex-col gap-3 border-t p-3 ${tones.border}`}>
						<label className="flex items-center gap-2 text-sm">
							<input type="checkbox" defaultChecked />
							Allow SSH access
						</label>
						<label htmlFor="pairing-ssh-key" className="text-sm" style={strong}>
							SSH public key
						</label>
						<textarea
							id="pairing-ssh-key"
							rows={2}
							placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA…"
							className={`border px-3 py-2 font-mono text-xs ${tones.strongBorder} ${tones.surface}`}
						/>
					</div>
				</details>
				<div className="flex justify-end gap-3">
					<Button variant="ghost">Cancel</Button>
					<Button>Create server</Button>
				</div>
			</div>
		</Frame>
	);
}

function ConnectScreen() {
	const { display, strong } = usePairing();
	const assistants = ["Claude", "ChatGPT", "Codex", "Other"];
	const steps = [
		"Copy the connection URL.",
		"Open the connector settings in your assistant.",
		"Paste the URL, then sign in to Composery.",
	];
	return (
		<Frame title="Connect an assistant">
			<div className="flex flex-col gap-5 p-6">
				<Heading level={2}>Connect an assistant</Heading>
				<div
					role="tablist"
					aria-label="Assistant"
					className={`flex border-b ${tones.border}`}
				>
					{assistants.map((assistant, index) => (
						<button
							key={assistant}
							type="button"
							role="tab"
							aria-selected={index === 0}
							className={`-mb-px border-b-2 px-4 py-2 text-sm ${
								index === 0
									? "border-current"
									: `border-transparent ${tones.muted}`
							}`}
							style={display}
						>
							{assistant}
						</button>
					))}
				</div>
				<ol className="flex flex-col gap-3">
					{steps.map((step, index) => (
						<li key={step} className="flex items-start gap-3 text-sm">
							<span
								className={`flex size-6 shrink-0 items-center justify-center text-xs tabular-nums ${tones.inverse}`}
								style={display}
							>
								{index + 1}
							</span>
							<span className="pt-0.5">{step}</span>
						</li>
					))}
				</ol>
				<div
					className={`flex items-center gap-2 border p-1 pl-3 ${tones.border}`}
				>
					<code
						className={`min-w-0 flex-1 truncate font-mono text-xs ${tones.muted}`}
					>
						https://studio.example.com/mcp
					</code>
					<Button size="small" variant="secondary">
						Copy
					</Button>
				</div>
				<p className={`text-sm ${tones.muted}`}>
					<span style={strong}>Tip:</span> Ask your assistant to “list my apps”
					to test the connection.
				</p>
			</div>
		</Frame>
	);
}

function PlansScreen() {
	const { display, label } = usePairing();
	const features = [
		["Daily backups", "Daily backups", "Hourly backups"],
		["1 server", "5 servers", "Unlimited servers"],
		["Community support", "Email support", "Priority support"],
	] as const;
	return (
		<Frame title="Pricing">
			<div className="flex flex-col gap-6 p-6">
				<div className="flex flex-col gap-2">
					<Label>Pricing</Label>
					<Heading level={2}>Choose a size</Heading>
				</div>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
					{plans.map((plan, planIndex) => (
						<div
							key={plan.name}
							className={`flex flex-col gap-4 border p-4 ${
								planIndex === 1 ? "border-current" : tones.border
							}`}
						>
							<div className="flex items-center justify-between">
								<span className="text-xs" style={label}>
									{plan.name}
								</span>
								{planIndex === 1 ? (
									<span
										className={`px-1.5 py-0.5 text-[10px] ${tones.inverse}`}
										style={label}
									>
										Popular
									</span>
								) : null}
							</div>
							<span className="text-4xl tabular-nums" style={display}>
								{plan.price}
								<span className={`text-sm ${tones.faint}`}> / month</span>
							</span>
							<span className={`text-sm tabular-nums ${tones.muted}`}>
								{plan.specs}
							</span>
							<ul className="flex flex-col gap-1.5 text-sm">
								{features.map((row) => (
									<li key={row[planIndex]} className="flex gap-2">
										<span aria-hidden="true" className={tones.faint}>
											—
										</span>
										{row[planIndex]}
									</li>
								))}
							</ul>
							<Button variant={planIndex === 1 ? "primary" : "secondary"}>
								Choose {plan.name}
							</Button>
						</div>
					))}
				</div>
			</div>
		</Frame>
	);
}

function DialogScreen() {
	return (
		<Frame title="Confirmation dialog">
			<div className={`flex items-center justify-center p-8 ${tones.sunken}`}>
				<div
					role="dialog"
					aria-labelledby="pairing-dialog-title"
					className={`flex w-full max-w-md flex-col gap-4 border p-6 shadow-lg ${tones.border} ${tones.surface}`}
				>
					<div id="pairing-dialog-title">
						<Heading level={3}>Delete studio?</Heading>
					</div>
					<p className={`text-sm leading-relaxed ${tones.muted}`}>
						This deletes the server and all of its apps, files, and automations.
						You cannot undo this.
					</p>
					<TextInput
						id="pairing-confirm"
						label="Type studio to confirm"
						placeholder="studio"
					/>
					<div className="flex justify-end gap-3">
						<Button variant="ghost">Cancel</Button>
						<Button variant="danger">Delete server</Button>
					</div>
				</div>
			</div>
		</Frame>
	);
}

function StatesScreen() {
	const { strong } = usePairing();
	return (
		<Frame title="States">
			<div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
				<div className="flex flex-col gap-2">
					<Label>Notifications</Label>
					<div
						className={`flex items-center justify-between gap-3 border p-3 text-sm shadow-sm ${tones.border} ${tones.surface}`}
					>
						<span className="flex items-center gap-2">
							<span aria-hidden="true" className="size-1.5 bg-emerald-500" />
							Server created.
						</span>
						<Button size="small" variant="ghost">
							Open
						</Button>
					</div>
					<div
						className={`flex items-center justify-between gap-3 border p-3 text-sm shadow-sm ${tones.border} ${tones.surface}`}
					>
						<span className="flex items-center gap-2">
							<span aria-hidden="true" className="size-1.5 bg-red-500" />
							Could not connect to studio.
						</span>
						<Button size="small" variant="ghost">
							Try again
						</Button>
					</div>
				</div>

				<div className="flex flex-col gap-2">
					<Label>Loading</Label>
					<div
						className={`flex flex-col gap-3 border p-4 ${tones.border}`}
						aria-busy="true"
					>
						<div className="h-4 w-1/3 animate-pulse bg-neutral-200 dark:bg-neutral-800" />
						<div className="h-3 w-2/3 animate-pulse bg-neutral-200 dark:bg-neutral-800" />
						<div className="h-3 w-1/2 animate-pulse bg-neutral-200 dark:bg-neutral-800" />
					</div>
				</div>

				<div className="flex flex-col gap-2">
					<Label>Empty</Label>
					<div
						className={`flex flex-col items-center gap-3 border border-dashed p-6 text-center ${tones.strongBorder}`}
					>
						<span className="text-base" style={strong}>
							No apps yet
						</span>
						<span className={`text-sm ${tones.muted}`}>
							Ask your assistant to build one, or add one here.
						</span>
						<Button size="small" variant="secondary">
							Add an app
						</Button>
					</div>
				</div>

				<div className="flex flex-col gap-2">
					<Label>Error</Label>
					<div
						className={`flex flex-col items-start gap-3 border p-4 ${tones.dangerBorder}`}
					>
						<span className={`text-base ${tones.danger}`} style={strong}>
							The server did not start
						</span>
						<span className={`text-sm ${tones.muted}`}>
							The provider did not respond. Your files are safe.
						</span>
						<Button size="small" variant="secondary">
							Try again
						</Button>
					</div>
				</div>
			</div>
		</Frame>
	);
}

const activity = [
	["12:04:31", "App deployed", "notes", "Claude"],
	["11:58:02", "Server started", "studio", "sam"],
	["11:40:17", "File uploaded", "invoices-2026.csv", "ChatGPT"],
	["09:12:45", "Automation ran", "daily-report", "schedule"],
	["08:00:00", "Backup completed", "studio", "system"],
] as const;

function ActivityScreen() {
	const { label, strong } = usePairing();
	return (
		<Frame title="Table">
			<div className="flex flex-col gap-4 p-6">
				<Heading level={3}>Activity</Heading>
				<table className="w-full min-w-[32rem] text-left text-sm">
					<thead>
						<tr className={`border-b ${tones.border}`}>
							{["Time", "Event", "Target", "By"].map((column) => (
								<th
									key={column}
									scope="col"
									className={`py-2 pr-4 font-normal text-xs ${tones.muted}`}
									style={label}
								>
									{column}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{activity.map(([time, event, target, actor]) => (
							<tr key={time} className={`border-b ${tones.border}`}>
								<td className={`py-2 pr-4 tabular-nums ${tones.muted}`}>
									{time}
								</td>
								<td className="py-2 pr-4" style={strong}>
									{event}
								</td>
								<td className="py-2 pr-4">{target}</td>
								<td className={`py-2 ${tones.muted}`}>{actor}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</Frame>
	);
}

function ButtonsScreen() {
	const variants: readonly ButtonVariant[] = [
		"primary",
		"secondary",
		"ghost",
		"danger",
	];
	const sizes: readonly ButtonSize[] = ["small", "medium", "large"];
	return (
		<Frame title="Buttons">
			<div className="flex flex-col gap-4 p-6">
				{sizes.map((size) => (
					<div key={size} className="flex flex-wrap items-center gap-3">
						{variants.map((variant) => (
							<Button key={variant} variant={variant} size={size}>
								{variant === "danger" ? "Delete" : "Deploy app"}
							</Button>
						))}
						<Button size={size} disabled>
							Disabled
						</Button>
					</div>
				))}
			</div>
		</Frame>
	);
}

function TypeScaleScreen() {
	const pairing = usePairing();
	const rows = [
		{
			name: "Heading 1",
			className: "text-5xl",
			style: pairing.heading,
			font: pairing.headingFont,
		},
		{
			name: "Heading 2",
			className: "text-2xl",
			style: pairing.heading,
			font: pairing.headingFont,
		},
		{
			name: "Heading 3",
			className: "text-lg",
			style: pairing.heading,
			font: pairing.headingFont,
		},
		{
			name: "Body",
			className: "text-base",
			style: pairing.body,
			font: pairing.textFont,
		},
		{
			name: "Small",
			className: "text-sm",
			style: pairing.body,
			font: pairing.textFont,
		},
		{
			name: "Label",
			className: "text-xs",
			style: pairing.label,
			font: pairing.displayFont,
		},
		{
			name: "Button",
			className: "text-sm",
			style: pairing.display,
			font: pairing.displayFont,
		},
		{
			name: "Figure",
			className: "text-3xl tabular-nums",
			style: pairing.display,
			font: pairing.displayFont,
		},
	];
	return (
		<Frame title="Type scale">
			<ul className="flex flex-col p-6">
				{rows.map((row) => (
					<li
						key={row.name}
						className={`flex items-baseline gap-4 border-b py-2 last:border-b-0 ${tones.border}`}
					>
						<span
							className={`w-36 shrink-0 font-sans text-[11px] ${tones.faint}`}
						>
							{row.name} · {row.font.name}
						</span>
						<span className={`truncate ${row.className}`} style={row.style}>
							{row.name === "Figure"
								? "38.2 / 40 GB"
								: "Deploy apps to your server"}
						</span>
					</li>
				))}
			</ul>
		</Frame>
	);
}

function FooterScreen() {
	return (
		<Frame title="Footer">
			<div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-5 text-sm">
				<Logo size={16} />
				<span className={tones.muted}>Privacy</span>
				<span className={tones.muted}>Terms</span>
				<span className={`ml-auto ${tones.faint}`}>© 2026 Composery</span>
			</div>
		</Frame>
	);
}

export function PairingScreens() {
	return (
		<div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
			<div className="xl:col-span-2">
				<HeroScreen />
			</div>
			<DashboardScreen />
			<CreateServerScreen />
			<ConnectScreen />
			<DialogScreen />
			<div className="xl:col-span-2">
				<PlansScreen />
			</div>
			<StatesScreen />
			<ActivityScreen />
			<ButtonsScreen />
			<TypeScaleScreen />
			<div className="xl:col-span-2">
				<FooterScreen />
			</div>
		</div>
	);
}
