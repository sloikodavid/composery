"use client";

import { ErrorPage, type ErrorBoundaryProps } from "@/ui/error-page";

export default function SiteError(props: ErrorBoundaryProps) {
	return <ErrorPage {...props} />;
}
