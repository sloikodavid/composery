import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Onest } from "next/font/google";
import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { ClerkClientProvider } from "@/components/providers/clerk-client";
import { ConvexClientProvider } from "@/components/providers/convex-client";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

const onest = Onest({ subsets: ["latin"], variable: "--font-onest" });

const chakraPetch = Chakra_Petch({
	subsets: ["latin"],
	weight: "500",
	variable: "--font-chakra-petch",
});

export const metadata: Metadata = {
	title: "Composery",
	description: "AI-first personal compute.",
};

export const viewport: Viewport = {
	colorScheme: "light dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html lang="en" className={`${onest.variable} ${chakraPetch.variable}`}>
			<body>
				<ClerkClientProvider>
					<ToastProvider>
						<ConvexClientProvider>
							<div className="flex min-h-lvh flex-col">
								<Header />
								{children}
							</div>
							<Footer />
						</ConvexClientProvider>
					</ToastProvider>
				</ClerkClientProvider>
			</body>
		</html>
	);
}
