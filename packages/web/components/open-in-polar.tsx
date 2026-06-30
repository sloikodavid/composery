"use client";

import type { VariantProps } from "class-variance-authority";
import type { buttonVariants } from "@/components/button";
import { OpenInDashboard } from "@/components/open-in-dashboard";
import {
	polarCustomersUrl,
	polarCustomerUrl,
	polarSubscriptionUrl
} from "@/lib/polar-dashboard";

export function OpenInPolar({
	className,
	customerId,
	iconOnly = false,
	label = "Open in Polar",
	size = "sm",
	subscriptionId
}: {
	className?: string;
	customerId?: string | null;
	iconOnly?: boolean;
	label?: string;
	size?: VariantProps<typeof buttonVariants>["size"];
	subscriptionId?: string | null;
}) {
	const href =
		subscriptionId !== undefined
			? subscriptionId
				? polarSubscriptionUrl(subscriptionId)
				: null
			: customerId === undefined
				? polarCustomersUrl()
				: polarCustomerUrl(customerId);

	return (
		<OpenInDashboard
			className={className}
			href={href}
			icon="polar"
			iconOnly={iconOnly}
			label={label}
			size={size}
		/>
	);
}
