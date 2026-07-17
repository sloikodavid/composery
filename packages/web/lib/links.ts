// Outbound coordinates: the repository, its community surfaces, and support.
// Everything derives from gitConfig so a fork repoints it in one place - see
// docs/developing/services/github.md, "Running your own".
export const gitConfig = {
	user: "sloikodavid",
	repo: "composery",
	branch: "main"
};

export const GITHUB_REPO_URL = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;
export const GITHUB_BUG_URL = `${GITHUB_REPO_URL}/issues/new?template=bug.yml`;
export const GITHUB_IDEAS_URL = `${GITHUB_REPO_URL}/discussions/categories/ideas`;
export const GITHUB_ADVISORY_URL = `${GITHUB_REPO_URL}/security/advisories/new`;
export const SUPPORT_EMAIL = "sloikodavid@gmail.com";
export const X_URL = `https://x.com/${gitConfig.user}`;
export const LINKEDIN_URL = "https://www.linkedin.com/company/composery";
