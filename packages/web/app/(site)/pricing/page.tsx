import type { Metadata } from "next";
import { Pricing } from "./_components/pricing";
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

	return (
		<Pricing
			initialBillingInterval={initialBillingInterval}
			initialSlug={sanitizeSlug(slug ?? "")}
		/>
	);
}
