import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Logo } from "@/components/logo";
import { GITHUB_REPO_URL } from "./links";

export function baseOptions(): BaseLayoutProps {
	return {
		slots: { navTitle: Logo },
		githubUrl: GITHUB_REPO_URL
	};
}
