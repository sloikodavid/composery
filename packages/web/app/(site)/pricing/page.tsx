import type { Metadata } from "next";
import { fetchQuery } from "convex/nextjs";
import { Pricing } from "./_components/pricing";
import { api } from "@/convex/_generated/api";
import {
	isBoxBillingInterval,
	type BoxBillingInterval
} from "@/lib/box-billing";
import { sanitizeSlug } from "@/lib/box-slug";

export const metadata: Metadata = {
	title: "Pricing"
};

export default async function PricingPage({
	searchParams
}: {
	searchParams: Promise<{ billing?: string; slug?: string }>;
}) {
	const { billing, slug } = await searchParams;
	const initialBillingInterval: BoxBillingInterval = isBoxBillingInterval(
		billing
	)
		? billing
		: "year";
	// Read on the server so the price is in the delivered HTML: it is the one
	// number a visitor and a crawler come to this page for.
	const pricing = await fetchQuery(api.billing.polar.boxPricing, {});

	return (
		<Pricing
			initialBillingInterval={initialBillingInterval}
			initialSlug={sanitizeSlug(slug ?? "")}
			pricing={pricing}
		/>
	);
}
