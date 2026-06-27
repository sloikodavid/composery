import { useColorScheme } from "react-native";

import { dark, light, type Palette } from "@/lib/theme";

/**
 * Returns the Composery palette for the current system color scheme, defaulting
 * to light when the system value is unknown.
 */
export function useTheme(): Palette {
	const scheme = useColorScheme();
	return scheme === "dark" ? dark : light;
}
