import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";

// Custom chrome is rendered per-screen, so hide the Stack header everywhere.
// add-instance is presented as a modal from the list.
export default function RootLayout() {
	const scheme = useColorScheme();
	return (
		<>
			<StatusBar style={scheme === "dark" ? "light" : "dark"} />
			<Stack screenOptions={{ headerShown: false }}>
				<Stack.Screen name="index" />
				<Stack.Screen name="add-instance" options={{ presentation: "modal" }} />
				<Stack.Screen name="instance/[id]" />
			</Stack>
		</>
	);
}
