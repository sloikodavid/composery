// Typography matched to the docs-website: SF on iOS (its --font-sans leads with
// -apple-system), Inter on Android/web, Bricolage Grotesque for headings.
// Import per weight from subpaths, not the package index — the index re-exports
// every weight + italic, bundling ~4MB of unused faces.
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { BricolageGrotesque_600SemiBold } from "@expo-google-fonts/bricolage-grotesque/600SemiBold";
import { BricolageGrotesque_700Bold } from "@expo-google-fonts/bricolage-grotesque/700Bold";
import { Platform, type TextStyle } from "react-native";

export const FONT_MAP = {
	Inter_400Regular,
	Inter_500Medium,
	Inter_600SemiBold,
	Inter_700Bold,
	BricolageGrotesque_600SemiBold,
	BricolageGrotesque_700Bold
};

type BodyWeight = "regular" | "medium" | "semibold" | "bold";

const interFamily: Record<BodyWeight, string> = {
	regular: "Inter_400Regular",
	medium: "Inter_500Medium",
	semibold: "Inter_600SemiBold",
	bold: "Inter_700Bold"
};

const iosWeight: Record<BodyWeight, TextStyle["fontWeight"]> = {
	regular: "400",
	medium: "500",
	semibold: "600",
	bold: "700"
};

// iOS: system font via weight. Android/web: the weighted Inter family, which
// carries its own weight (so we don't also set fontWeight).
export function body(weight: BodyWeight = "regular"): TextStyle {
	return Platform.OS === "ios"
		? { fontWeight: iosWeight[weight] }
		: { fontFamily: interFamily[weight] };
}

export function heading(weight: "semibold" | "bold" = "bold"): TextStyle {
	return {
		fontFamily:
			weight === "bold"
				? "BricolageGrotesque_700Bold"
				: "BricolageGrotesque_600SemiBold"
	};
}
