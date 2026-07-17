import type { Metadata } from "next";
import { NewBox } from "./_components/new-box";
import { redirectIfSignedOut } from "@/lib/route-guards";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "New Box"
};

export default async function NewBoxPage() {
	await redirectIfSignedOut("/boxes/new");

	return <NewBox />;
}
