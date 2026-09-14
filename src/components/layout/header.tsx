import { Logo } from "@/components/brand/logo";
import { UserControl } from "@/components/layout/user-control";
import { Container } from "@/components/ui/container";

export function Header() {
	return (
		<header>
			<Container className="flex h-20 items-center justify-between">
				<Logo className="text-xl" />
				<UserControl />
			</Container>
		</header>
	);
}
