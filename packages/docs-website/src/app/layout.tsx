import { RootProvider } from "fumadocs-ui/provider/next";
import "./global.css";
import type { Metadata } from "next";
import { cn } from "@/lib/cn";
import { bricolage, inter } from "./fonts";

export const metadata: Metadata = {
	metadataBase: new URL("https://docs.composery.io"),
	title: {
		default: "Composery",
		template: "%s | Composery"
	},
	description:
		"A persistent, VPS-like Linux appliance with code-server in the browser."
};

export default function Layout({ children }: LayoutProps<"/">) {
	return (
		<html
			lang="en"
			className={cn(inter.variable, bricolage.variable)}
			suppressHydrationWarning
		>
			<body className="flex flex-col min-h-screen">
				<RootProvider>{children}</RootProvider>
			</body>
		</html>
	);
}
