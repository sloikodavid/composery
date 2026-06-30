import { Icon } from "@/components/icon";
import { LogoLockup } from "@/components/logo";

/*
 * The Composery logo: the icon on its own, and the full lockup (icon + wordmark).
 * Rendered on the live theme surface - the icon's amber is color-stable and the
 * wordmark follows the foreground, so both hold in light and dark.
 */
export function LogoShowcase() {
	return (
		<div className="flex flex-wrap items-center gap-x-10 gap-y-6">
			<div className="flex items-center gap-4">
				<Icon className="size-12" />
				<Icon className="size-8" />
				<Icon className="size-6" />
			</div>
			<LogoLockup className="h-10 w-auto text-foreground" />
			<LogoLockup className="h-6 w-auto text-foreground" />
		</div>
	);
}
