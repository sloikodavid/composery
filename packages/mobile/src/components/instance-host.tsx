// Mounted once, above the navigator, so the instance WebView it renders survives
// a back-to-the-list navigation instead of being torn down and rebooted. It keeps
// the last-opened instance warm (one live workbench, bounded memory): returning to
// it is instant; opening a different one replaces it. Absolutely positioned over
// the whole app and cross-faded, so when no instance is focused it is invisible and
// lets touches through to the list beneath.
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";

import { InstanceView } from "@/components/instance-view";
import { useActiveInstanceId } from "@/lib/instance-host";
import { leaveScreen } from "@/lib/nav";

export function InstanceHost() {
	const activeId = useActiveInstanceId();
	// The instance held warm. It sticks after activeId goes null (leaving to the
	// list) so the WebView stays mounted, and only changes when a *different*
	// instance is opened - which is the one case that discards the old workbench.
	// Derived from activeId during render (React's supported "adjust state while
	// rendering" pattern), not in an effect, so the switch has no extra frame.
	const [warmId, setWarmId] = useState<string | null>(activeId);
	if (activeId !== null && activeId !== warmId) setWarmId(activeId);

	const active = activeId !== null && activeId === warmId;

	// Leave at most once per visit: the page answers a back press a frame late, so a
	// "composery:back" can arrive after we already left, and popping twice would
	// drop past the list. Re-armed each time this becomes the active view.
	const leftRef = useRef(false);
	useEffect(() => {
		if (active) leftRef.current = false;
	}, [active]);
	const onLeave = useCallback(() => {
		if (leftRef.current) return;
		leftRef.current = true;
		leaveScreen();
	}, []);

	const { width } = useWindowDimensions();

	if (warmId === null) return null;

	// Hidden by sliding off-screen, never by display:none or opacity. An Android
	// WebView draws on its own hardware surface that ignores React Native opacity
	// (fading left a white sheet over the list) and does not repaint cleanly when
	// toggled back from display:none (it came back blank white). Translating the
	// still-laid-out, still-painted layer fully off the right edge reveals the list
	// beneath and brings the workbench back instantly - the WebView is never
	// unmounted (device-verified: its page state survives the round trip) and never
	// stops rendering, so there is no reboot and no blank frame. pointerEvents off
	// when parked so it can't catch touches meant for the list.
	return (
		<View
			style={[
				StyleSheet.absoluteFill,
				{ transform: [{ translateX: active ? 0 : width }] }
			]}
			pointerEvents={active ? "auto" : "none"}
		>
			{/* key by warmId: a different instance remounts (boots fresh); returning
			    to the same one keeps this mounted, so its WebView never reboots. */}
			<InstanceView
				key={warmId}
				instanceId={warmId}
				active={active}
				onLeave={onLeave}
			/>
		</View>
	);
}
