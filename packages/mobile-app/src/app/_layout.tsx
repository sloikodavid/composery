import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { FONT_MAP } from "@/lib/fonts";
import { dark, light } from "@/lib/theme";

// Hold the splash until fonts load, so the first frame is the real UI in the
// brand font — never a flash of fallback text.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
	const scheme = useColorScheme();
	const theme = scheme === "dark" ? dark : light;
	const [fontsLoaded, fontError] = useFonts(FONT_MAP);

	// Paint the native root view so transitions and any gap below the JS never
	// flash white.
	useEffect(() => {
		void SystemUI.setBackgroundColorAsync(theme.background);
	}, [theme.background]);

	useEffect(() => {
		if (fontsLoaded || fontError) void SplashScreen.hideAsync();
	}, [fontsLoaded, fontError]);

	if (!fontsLoaded && !fontError) return null;

	return (
		<GestureHandlerRootView
			style={{ flex: 1, backgroundColor: theme.background }}
		>
			<SafeAreaProvider>
				<StatusBar style={scheme === "dark" ? "light" : "dark"} />
				<Stack
					screenOptions={{
						headerShown: false,
						contentStyle: { backgroundColor: theme.background }
					}}
				>
					<Stack.Screen name="index" />
					<Stack.Screen
						name="add-instance"
						options={{ presentation: "modal" }}
					/>
					<Stack.Screen name="instance/[id]" />
				</Stack>
			</SafeAreaProvider>
		</GestureHandlerRootView>
	);
}
