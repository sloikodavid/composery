import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { NavLogoLink } from "@/components/logo";
import { GITHUB_REPO_URL } from "./links";

export function baseOptions(): BaseLayoutProps {
	return {
		slots: { navTitle: NavLogoLink },
		githubUrl: GITHUB_REPO_URL
	};
}
