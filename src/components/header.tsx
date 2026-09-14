import { AuthButton } from "@/components/auth-button";
import { Logo } from "@/components/brand/logo";
import { Container } from "@/components/ui/container";

export function Header() {
	return (
		<header>
			<Container className="flex h-20 items-center justify-between">
				<Logo className="text-xl" />
				<AuthButton intent="sign-in" />
			</Container>
		</header>
	);
}
