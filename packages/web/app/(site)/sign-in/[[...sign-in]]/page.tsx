import { SignIn } from "@clerk/nextjs";
import type { Metadata } from "next";
import { clerkAppearance } from "@/lib/clerk-appearance";
import { redirectIfSignedIn } from "@/lib/route-guards";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	title: "Sign In"
};

export default async function SignInPage() {
	await redirectIfSignedIn("/");

	return (
		<section className="mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-md items-center justify-center px-4">
			<div className="page-fade-in w-full">
				<SignIn
					appearance={clerkAppearance}
					path="/sign-in"
					routing="path"
					withSignUp
				/>
			</div>
		</section>
	);
}
