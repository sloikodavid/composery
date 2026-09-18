import { Container } from "@/components/ui/container";
import { Table } from "@/components/ui/table";

const columns = [
	{ id: "name", href: "/?sort=name", text: "Name" },
	{ id: "status", href: "/?sort=status", text: "Status" },
	{ id: "address", href: "/?sort=address", text: "Address" },
] as const;

const rows = [
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
	{
		id: "testServer",
		href: "/",
		cells: ["Test server", "Running", "192.0.2.30"],
	},
] as const;

export default function Home() {
	return (
		<main className="flex-1">
			<Container className="py-10">
				<Table columns={columns} label="Servers" rows={rows} />
			</Container>
		</main>
	);
}
