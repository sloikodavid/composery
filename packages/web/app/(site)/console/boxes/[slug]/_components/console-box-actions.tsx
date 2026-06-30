"use client";

import { useQuery } from "convex/react";
import { BoxActionsBar } from "@/components/box-actions-bar";
import { api } from "@/convex/_generated/api";

export function ConsoleBoxActions({ slug }: { slug: string }) {
	const detail = useQuery(api.staff.boxes.boxDetail, { slug });
	if (!detail) return null;

	return <BoxActionsBar runtimeUrl={detail.box.runtimeUrl} />;
}
