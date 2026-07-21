import { Alert, Linking } from "react-native";

// Linking rejects when the OS has no handler or refuses the URL. Every caller
// deliberately blocks the in-app navigation first, so swallowing that failure
// would make a tap do nothing with no way for the user to know why.
export async function openExternalUrl(url: string): Promise<void> {
	try {
		await Linking.openURL(url);
	} catch {
		Alert.alert(
			"Couldn't open link",
			"No app on this device could open that address."
		);
	}
}
