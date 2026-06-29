import { useColorScheme } from "react-native";

import { themeForScheme, type Palette } from "@/lib/theme";

export type Theme = Palette;

// Composery palette for the current scheme; defaults to light when unknown.
export function useTheme(): Theme {
	return themeForScheme(useColorScheme());
}
