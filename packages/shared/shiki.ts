import { theme } from "./theme.ts";

// Two Shiki themes for code highlighting, derived from the palette so code can
// never show a colour the brand does not own. Each syntax role maps onto one of
// the palette's own state colours: keywords take the warning tone, strings the
// success tone, numbers the info tone, and comments and punctuation the muted
// foreground. The background stays transparent - the code sits on the card
// surface around it, like everything else on the page.
function codeTheme(mode: "light" | "dark") {
	const c = theme[mode];
	return {
		name: `composery-${mode}`,
		type: mode,
		bg: "transparent",
		fg: c.foreground,
		settings: [
			{ scope: ["comment"], settings: { foreground: c.mutedForeground } },
			{
				scope: ["keyword", "storage"],
				settings: { foreground: c.warning }
			},
			{ scope: ["string"], settings: { foreground: c.success } },
			{
				scope: ["constant.numeric", "constant.language", "constant.other"],
				settings: { foreground: c.info }
			},
			{
				scope: ["entity.name.function", "support.function"],
				settings: { foreground: c.foreground }
			},
			{
				scope: ["entity.name.type", "entity.name.class", "support.type"],
				settings: {
					foreground: mode === "light" ? c.chart5 : c.primaryButtonHover
				}
			},
			{
				scope: ["punctuation", "operator", "keyword.operator", "delimiter"],
				settings: { foreground: c.mutedForeground }
			}
		]
	};
}

export const SHIKI_THEMES = {
	light: codeTheme("light"),
	dark: codeTheme("dark")
};
