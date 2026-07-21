import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
	initialWindowMetrics,
	SafeAreaProvider
} from "react-native-safe-area-context";

import { InstanceHost } from "@/components/instance-host";
import { FONT_MAP } from "@/lib/fonts";
import { themeForScheme } from "@/lib/theme";

// Every screen is reachable by deep link (composery://instance/:id from a QR
// code, composery://add-instance). Anchoring the stack to the list puts it
// underneath them, so back from a deep-linked screen goes to the instances the
// user has rather than straight out of the app.
export const unstable_settings = { initialRouteName: "index" };

// Hold the splash until fonts load, so the first frame is the real UI in the
// brand font — never a flash of fallback text.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
	const scheme = useColorScheme();
	const theme = themeForScheme(scheme);
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
			{/* Insets measured natively arrive a frame late, and the instance
			    screen sizes its status-bar strip from insets.top - so without the
			    startup metrics the IDE's title bar paints under the status bar for
			    a frame and then jumps down. */}
			<SafeAreaProvider initialMetrics={initialWindowMetrics}>
				<BottomSheetModalProvider>
					{/* "auto" is dark icons on a light scheme and light on dark. */}
					<StatusBar style="auto" />
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
						<Stack.Screen
							name="scan"
							options={{ presentation: "fullScreenModal", animation: "fade" }}
						/>
						{/* The route is a thin marker; InstanceHost below renders the IDE
						    (see components/instance-host.tsx). No slide - the host cross-fades
						    - and transparent so the host, not an empty screen, is what shows. */}
						<Stack.Screen
							name="instance/[id]"
							options={{
								animation: "none",
								contentStyle: { backgroundColor: "transparent" }
							}}
						/>
					</Stack>
					{/* Above the navigator so its WebView survives leaving to the list. */}
					<InstanceHost />
				</BottomSheetModalProvider>
			</SafeAreaProvider>
		</GestureHandlerRootView>
	);
}
