"use client";

import { useQuery } from "convex/react";
import { OpenInConvex } from "@/components/open-in-convex";
import { OpenInHetzner } from "@/components/open-in-hetzner";
import { OpenInPolar } from "@/components/open-in-polar";
import { api } from "@/convex/_generated/api";

// The console dashboard links beside the slug in the breadcrumb. Shares the
// boxDetail subscription with the detail view, so it adds no extra reads; the
// group stays hidden until the box record is loaded, then fades in together.
export function ConsoleBoxLinks({ slug }: { slug: string }) {
	const detail = useQuery(api.staff.boxes.boxDetail, { slug });
	if (!detail) return null;

	return (
		<span className="page-fade-in inline-flex items-center gap-1">
			<OpenInHetzner
				iconOnly
				label={`Open ${slug} server in Hetzner`}
				serverId={detail.box.hetznerServerId ?? null}
			/>
			<OpenInPolar
				iconOnly
				label={`Open ${slug} subscription in Polar`}
				subscriptionId={detail.box.polarSubscriptionId ?? null}
			/>
			<OpenInConvex
				field="slug"
				iconOnly
				table="boxes"
				value={detail.box.slug}
			/>
		</span>
	);
}
