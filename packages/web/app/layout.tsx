import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/sonner";
import { appDescription, siteUrl } from "@/lib/shared";
import { cn } from "@/lib/utils";
import { inter } from "./fonts";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
	metadataBase: new URL(siteUrl),
	title: {
		default: "Composery: like VS Code, but always on",
		template: "%s - Composery"
	},
	description: appDescription,
	alternates: { canonical: "./" },
	openGraph: {
		siteName: "Composery",
		type: "website",
		url: "./"
	}
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<html
			className={cn("antialiased", inter.variable)}
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
