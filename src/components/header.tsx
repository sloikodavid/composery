import { AccountControl } from "@/components/account-control";
import { Logo } from "@/components/brand/logo";
import { Container } from "@/components/ui/container";

export function Header() {
	return (
		<header>
			<Container className="flex h-20 items-center justify-between">
				<Logo className="text-xl" />
				<AccountControl />
			</Container>
		</header>
	);
}
