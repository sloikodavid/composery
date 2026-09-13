import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import "./globals.css";

export const metadata: Metadata = {
	title: "Composery",
	description: "AI-first personal compute.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html lang="en">
			<body>
				<ClerkProvider>
					<ConvexClientProvider>{children}</ConvexClientProvider>
				</ClerkProvider>
			</body>
		</html>
	);
}
