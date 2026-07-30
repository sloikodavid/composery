import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";

type AndroidResources = {
	resources: {
		color?: { _: string; $: { name: string } }[];
		style?: {
			$: { name: string; parent?: string };
			item?: { _: string; $: { name: string } }[];
		}[];
	};
};

type ModConfig = {
	modRequest: {
		introspect: boolean;
		platform: "android";
		projectName: string;
		projectRoot: string;
	};
	modResults: AndroidResources;
	name: string;
	slug: string;
};

type AndroidDialogTheme = {
	(config: { name: string; slug: string }): {
		mods: {
			android: Record<
				"colors" | "colorsNight" | "styles",
				(config: ModConfig) => Promise<ModConfig>
			>;
		};
		name: string;
		slug: string;
	};
	ACCENT: { dark: string; light: string };
	COLOR_NAME: string;
};

const require = createRequire(import.meta.url);
const plugin =
	require("../../../plugins/android-dialog-theme.js") as AndroidDialogTheme;

function modConfig(modResults: AndroidResources): ModConfig {
	return {
		modRequest: {
			introspect: true,
			platform: "android",
			projectName: "composery",
			projectRoot: process.cwd()
		},
		modResults,
		name: "Composery",
		slug: "composery"
	};
}

describe("android dialog theme plugin", () => {
	test("writes both framework theme attributes and day/night accent resources", async () => {
		const configured = plugin({ name: "Composery", slug: "composery" });
		const { colors, colorsNight, styles } = configured.mods.android;

		const styled = await styles(modConfig({ resources: { style: [] } }));
		const light = await colors(modConfig({ resources: { color: [] } }));
		const dark = await colorsNight(modConfig({ resources: { color: [] } }));

		const appTheme = styled.modResults.resources.style?.find(
			(style) => style.$.name === "AppTheme"
		);
		expect(
			Object.fromEntries(
				appTheme?.item?.map((item) => [item.$.name, item._]) ?? []
			)
		).toEqual({
			colorAccent: `@color/${plugin.COLOR_NAME}`,
			"android:colorAccent": `@color/${plugin.COLOR_NAME}`
		});
		expect(light.modResults.resources.color).toEqual([
			{ $: { name: plugin.COLOR_NAME }, _: plugin.ACCENT.light }
		]);
		expect(dark.modResults.resources.color).toEqual([
			{ $: { name: plugin.COLOR_NAME }, _: plugin.ACCENT.dark }
		]);
	});
});
