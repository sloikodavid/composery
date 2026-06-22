import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { NavLogoLink } from "@/components/logo";
import { gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
	return {
		// Override the title slot so the lockup owns its own link: home first,
		// then out to the marketing site once already on the docs home.
		slots: { navTitle: NavLogoLink },
		githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`
	};
}
