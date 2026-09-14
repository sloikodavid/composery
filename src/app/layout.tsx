import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Onest } from "next/font/google";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
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
			<body className="flex min-h-dvh flex-col">
				<ClerkProvider>
					<ConvexClientProvider>
						<Header />
						{children}
						<Footer />
					</ConvexClientProvider>
				</ClerkProvider>
			</body>
		</html>
	);
}
