import { CameraView, useCameraPermissions } from "expo-camera";
import { router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Flashlight } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Linking, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BackButton } from "@/components/back-button";
import { PressableScale } from "@/components/pressable-scale";
import { Spinner } from "@/components/spinner";
import { body, heading } from "@/lib/fonts";
import { errorFeedback, successFeedback } from "@/lib/haptics";
import { parseScannedInstance } from "@/lib/parse-scanned";
import { useTheme } from "@/lib/use-theme";

const SCRIM = "rgba(0,0,0,0.6)";
const FRAME_SCALE = 0.7;

export default function ScanScreen() {
	const theme = useTheme();
	const { width, height } = useWindowDimensions();
	// A generous square that stays comfortably inside the narrowest screens.
	const frame = Math.min(width, height) * FRAME_SCALE;
	const [permission, requestPermission] = useCameraPermissions();
	const [torch, setTorch] = useState(false);
	const [hint, setHint] = useState<string | null>(null);
	// Latches on the first decode so a stream of frames can't fire navigation (or
	// the error haptic) repeatedly; re-armed after a rejected code.
	const locked = useRef(false);
	const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (retryTimer.current) clearTimeout(retryTimer.current);
		},
		[]
	);

	function onScan(value: string) {
		if (locked.current) return;
		locked.current = true;

		const url = parseScannedInstance(value);
		if (!url) {
			errorFeedback();
			setHint("That isn't a Composery URL");
			retryTimer.current = setTimeout(() => {
				setHint(null);
				locked.current = false;
				retryTimer.current = null;
			}, 1600);
			return;
		}

		successFeedback();
		// Hand off to the add screen prefilled, so the user confirms and labels it
		// rather than it being added silently. replace() so Back doesn't land on
		// the camera again.
		router.replace({ pathname: "/add-instance", params: { url } });
	}

	// Permission still resolving on first mount.
	if (!permission) {
		return (
			<View style={styles_loading}>
				<Spinner color="#ffffff" size={32} />
			</View>
		);
	}

	if (!permission.granted) {
		return (
			<SafeAreaView style={styles_permission} edges={["top", "bottom"]}>
				<BackButton variant="overlay" testID="scan-back" />
				<View style={styles_permissionBody}>
					<Text style={[heading("bold"), { fontSize: 22, color: "#ffffff" }]}>
						Camera access
					</Text>
					<Text
						style={[
							body(),
							{
								fontSize: 15,
								lineHeight: 22,
								textAlign: "center",
								color: "rgba(255,255,255,0.7)",
								marginTop: 8
							}
						]}
					>
						Composery needs your camera to scan an instance QR code.
					</Text>
					<PressableScale
						testID="scan-permission-action"
						onPress={() => {
							if (permission.canAskAgain) void requestPermission();
							else void Linking.openSettings();
						}}
						style={{
							backgroundColor: theme.primary,
							paddingHorizontal: 22,
							paddingVertical: 13,
							borderRadius: 12,
							marginTop: 24
						}}
					>
						<Text
							style={[
								body("semibold"),
								{ fontSize: 16, color: theme.primaryForeground }
							]}
						>
							{permission.canAskAgain ? "Allow camera" : "Open settings"}
						</Text>
					</PressableScale>
				</View>
			</SafeAreaView>
		);
	}

	return (
		<View style={{ flex: 1, backgroundColor: "#000000" }}>
			<StatusBar style="light" />
			<CameraView
				style={{ ...styles_fill }}
				facing="back"
				enableTorch={torch}
				barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
				onBarcodeScanned={({ data }) => onScan(data)}
			/>

			{/* Scrim with a clear square cut into the middle (top/bottom flex are
			    equal, so the frame is vertically centered). */}
			<View style={styles_fill} pointerEvents="box-none">
				<View style={{ flex: 1, backgroundColor: SCRIM }} />
				<View style={{ flexDirection: "row", height: frame }}>
					<View style={{ flex: 1, backgroundColor: SCRIM }} />
					<View style={{ width: frame, height: frame }}>
						<Corner color={theme.primary} top left />
						<Corner color={theme.primary} top right />
						<Corner color={theme.primary} bottom left />
						<Corner color={theme.primary} bottom right />
					</View>
					<View style={{ flex: 1, backgroundColor: SCRIM }} />
				</View>
				<View
					style={{
						flex: 1,
						backgroundColor: SCRIM,
						alignItems: "center",
						paddingTop: 28
					}}
				>
					<Text
						testID="scan-hint"
						style={[
							body("medium"),
							{
								fontSize: 15,
								color: hint ? "#fca5a5" : "rgba(255,255,255,0.85)",
								textAlign: "center",
								paddingHorizontal: 32
							}
						]}
					>
						{hint ?? "Point at the QR code on your Composery"}
					</Text>
				</View>
			</View>

			{/* Header: close + title, over the scrim. */}
			<SafeAreaView
				style={styles_header}
				edges={["top"]}
				pointerEvents="box-none"
			>
				<BackButton variant="overlay" testID="scan-back" />
				<Text style={[heading("semibold"), { fontSize: 17, color: "#ffffff" }]}>
					Scan QR code
				</Text>
				<View style={{ width: 40 }} />
			</SafeAreaView>

			{/* Torch toggle, bottom center. */}
			<SafeAreaView
				style={styles_footer}
				edges={["bottom"]}
				pointerEvents="box-none"
			>
				<PressableScale
					testID="scan-torch"
					accessibilityRole="button"
					accessibilityLabel={torch ? "Turn off torch" : "Turn on torch"}
					onPress={() => {
						setTorch((on) => !on);
					}}
					style={styles_round(torch ? "#ffffff" : "rgba(0,0,0,0.45)")}
				>
					<Flashlight
						size={22}
						color={torch ? "#000000" : "#ffffff"}
						strokeWidth={2}
					/>
				</PressableScale>
			</SafeAreaView>
		</View>
	);
}

// One L-shaped accent at a corner of the frame.
function Corner({
	color,
	top,
	bottom,
	left,
	right
}: {
	color: string;
	top?: boolean;
	bottom?: boolean;
	left?: boolean;
	right?: boolean;
}) {
	const len = 26;
	const thick = 3;
	// Square corners, matching the scrim's rectangular cutout — rounding them left
	// gaps where the curve pulled away from the sharp dark edges.
	return (
		<View
			style={{
				position: "absolute",
				width: len,
				height: len,
				top: top ? 0 : undefined,
				bottom: bottom ? 0 : undefined,
				left: left ? 0 : undefined,
				right: right ? 0 : undefined,
				borderColor: color,
				borderTopWidth: top ? thick : 0,
				borderBottomWidth: bottom ? thick : 0,
				borderLeftWidth: left ? thick : 0,
				borderRightWidth: right ? thick : 0
			}}
		/>
	);
}

const styles_fill = {
	position: "absolute",
	top: 0,
	left: 0,
	right: 0,
	bottom: 0
} as const;

const styles_loading = {
	flex: 1,
	backgroundColor: "#000000",
	alignItems: "center",
	justifyContent: "center"
} as const;

const styles_permission = {
	flex: 1,
	backgroundColor: "#000000"
} as const;

const styles_permissionBody = {
	flex: 1,
	alignItems: "center",
	justifyContent: "center",
	paddingHorizontal: 36
} as const;

const styles_header = {
	position: "absolute",
	top: 0,
	left: 0,
	right: 0,
	flexDirection: "row",
	alignItems: "center",
	justifyContent: "space-between",
	paddingHorizontal: 16,
	paddingVertical: 12
} as const;

const styles_footer = {
	position: "absolute",
	bottom: 0,
	left: 0,
	right: 0,
	alignItems: "center",
	paddingBottom: 28
} as const;

const styles_round = (backgroundColor: string) =>
	({
		width: 44,
		height: 44,
		borderRadius: 22,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor
	}) as const;
