"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { boxPath } from "@/lib/box-route";

export function CheckoutRedirect({ checkoutId }: { checkoutId?: string }) {
	const router = useRouter();
	const checkout = useQuery(
		api.user.checkout.completedCheckout,
		checkoutId ? { checkoutId } : "skip"
	);

	useEffect(() => {
		if (checkout?.boxId) router.replace(boxPath(checkout.boxId));
	}, [checkout?.boxId, router]);

	return null;
}
