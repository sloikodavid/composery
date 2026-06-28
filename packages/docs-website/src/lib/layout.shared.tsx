import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { NavLogoLink } from "@/components/logo";
import { gitConfig } from "./shared";

export function baseOptions(): BaseLayoutProps {
	return {
		slots: { navTitle: NavLogoLink },
		githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`
	};
}
