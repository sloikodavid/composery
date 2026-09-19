import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Container } from "@/components/ui/container";

export const metadata: Metadata = { title: "Sign in · Composery" };

export default function SignInPage() {
	return (
		<main className="flex flex-1">
			<Container className="flex flex-1 items-center justify-center py-16">
				<SignIn />
			</Container>
		</main>
	);
}
