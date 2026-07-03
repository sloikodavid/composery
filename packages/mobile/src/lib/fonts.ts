// Typography matched to the website: Apple system fonts on iOS, Inter elsewhere,
// with tighter, medium-weight headings for a Linear-ish feel.
// Import per weight from subpaths, not the package index - the index re-exports
// every weight + italic, bundling ~4MB of unused faces.
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_500Medium } from "@expo-google-fonts/inter/500Medium";
import { Inter_600SemiBold } from "@expo-google-fonts/inter/600SemiBold";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";
import { Platform } from "react-native";
import type { TextStyle } from "react-native";

export const FONT_MAP = {
	Inter_400Regular,
	Inter_500Medium,
	Inter_600SemiBold,
	Inter_700Bold
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

const bodyTracking: Record<BodyWeight, number> = {
	regular: -0.12,
	medium: -0.1,
	semibold: -0.08,
	bold: -0.06
};

const platformTextTrim: TextStyle =
	Platform.OS === "android" ? { includeFontPadding: false } : {};

export function body(weight: BodyWeight = "regular"): TextStyle {
	return Platform.OS === "ios"
		? { fontWeight: iosWeight[weight] }
		: {
				...platformTextTrim,
				fontFamily: interFamily[weight],
				letterSpacing: bodyTracking[weight]
			};
}

export function heading(weight: "semibold" | "bold" = "bold"): TextStyle {
	const resolvedWeight = weight === "bold" ? "semibold" : weight;
	return Platform.OS === "ios"
		? { fontWeight: iosWeight[resolvedWeight], letterSpacing: -0.45 }
		: {
				...platformTextTrim,
				fontFamily: interFamily[resolvedWeight],
				letterSpacing: -0.45
			};
}
