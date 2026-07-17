"use client";

import { useQuery } from "convex/react";
import type { AnimatedIconName } from "@/components/animated-icon";
import { api } from "@/convex/_generated/api";

export type NavLink = {
	href: string;
	icon: AnimatedIconName;
	label: string;
};

export const PUBLIC_NAV_LINKS: NavLink[] = [
	{ href: "/pricing", icon: "wallet", label: "Pricing" },
	{ href: "/docs", icon: "book-open", label: "Docs" }
];

const USER_LINKS: NavLink[] = [
	{ href: "/boxes", icon: "washing-machine", label: "Boxes" }
];
const STAFF_LINKS: NavLink[] = [
	{ href: "/console", icon: "layout-grid", label: "Console" },
	{ href: "/design", icon: "pen-tool", label: "Design" }
];

export function useAuthedNavLinks(): NavLink[] {
	const capabilities = useQuery(api.users.currentUserCapabilities) ?? [];
	const isStaff = capabilities.includes("staff_console");
	return [...USER_LINKS, ...(isStaff ? STAFF_LINKS : [])];
}
