import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = { title: "Sign in · Composery" };

// The region fills the viewport below the header, so the component is centered on screen and mounting it moves nothing else.
export default function SignInPage() {
	return (
		<main className="flex flex-1">
			<Container className="flex flex-1 items-center justify-center py-16">
				<SignIn />
			</Container>
		</main>
	);
}
