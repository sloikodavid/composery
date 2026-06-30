import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/sonner";
import { cn } from "@/lib/utils";
import { bricolage, inter } from "./fonts";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
	metadataBase: new URL("https://www.composery.io"),
	title: {
		default: "Composery",
		template: "%s | Composery"
	},
	description:
		"Like VS Code, yet always on in the cloud, usable from any browser or phone, and made for long-running AI agents."
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html
			className={cn("antialiased", inter.variable, bricolage.variable)}
			lang="en"
			suppressHydrationWarning
		>
			<body>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					disableTransitionOnChange
					enableSystem
				>
					{/* The marketing/app chrome (Header + width-constrained main) lives
					    in the (site) route group; the /docs subtree gets fumadocs' own
					    chrome instead. Everything else here is genuinely app-wide. */}
					<Providers>
						{children}
						<Toaster />
					</Providers>
				</ThemeProvider>
				{/* Both are cookieless and privacy-first, so no consent banner is
				    required (we set only Clerk's strictly-necessary auth cookies).
				    Auto no-op off Vercel; only beacon in production. */}
				<Analytics />
				<SpeedInsights />
			</body>
		</html>
	);
}
