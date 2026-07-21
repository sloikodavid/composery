// The instance view itself lives in InstanceHost, mounted above the navigator so
// its WebView survives leaving to the list (see components/instance-host.tsx).
// This route only marks which instance is focused, and gates the iOS edge-swipe
// on the page's layer state - both while it is the screen on top.
import {
	useFocusEffect,
	useLocalSearchParams,
	useNavigation
} from "expo-router";
import { useCallback, useEffect } from "react";

import { iosSwipeEnabled } from "@/lib/back-decision";
import {
	clearActiveInstance,
	setActiveInstance,
	useHostBackState
} from "@/lib/instance-host";

export default function InstanceRoute() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const navigation = useNavigation();
	const { pageVisible, pageLayerOpen } = useHostBackState();

	useFocusEffect(
		useCallback(() => {
			setActiveInstance(id);
			return () => clearActiveInstance(id);
		}, [id])
	);

	// iOS has no hardware back: the screen-edge swipe is the system's back and pops
	// this route without the page getting the refusal Android's back gives it. Gate
	// it so it can never pop out from under an open layer (see back-decision).
	useEffect(() => {
		navigation.setOptions({
			gestureEnabled: iosSwipeEnabled({ pageVisible, pageLayerOpen })
		});
	}, [navigation, pageVisible, pageLayerOpen]);

	return null;
}
