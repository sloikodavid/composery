const SLUG = process.env.NEXT_PUBLIC_POLAR_ORGANIZATION_SLUG;
const ENVIRONMENT = process.env.NEXT_PUBLIC_POLAR_ENVIRONMENT;
const HOST =
	ENVIRONMENT === "production"
		? "polar.sh"
		: ENVIRONMENT === "sandbox"
			? "sandbox.polar.sh"
			: null;

function dashboardUrl(path: string) {
	if (!SLUG || !HOST) return null;
	return `https://${HOST}/dashboard/${SLUG}/${path}`;
}

export function polarCustomersUrl() {
	return dashboardUrl("customers");
}

export function polarCustomerUrl(customerId: string | null | undefined) {
	if (!customerId) return null;
	return dashboardUrl(`customers/${customerId}`);
}

export function polarSubscriptionUrl(
	subscriptionId: string | null | undefined
) {
	if (!subscriptionId) return null;
	return dashboardUrl(`sales/subscriptions/${subscriptionId}`);
}
