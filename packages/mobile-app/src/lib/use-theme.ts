import { useColorScheme } from "react-native";

import { dark, light, type Palette } from "@/lib/theme";

export type Theme = Palette;

// Composery palette for the current scheme; defaults to light when unknown.
export function useTheme(): Theme {
	const scheme = useColorScheme();
	return scheme === "dark" ? dark : light;
}
