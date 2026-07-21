// The one back/dismiss affordance, shared so every screen's back action looks
// and feels identical: a round ArrowLeft button in the app's button vocabulary.
import { ArrowLeft } from "lucide-react-native";

import { PressableScale } from "@/components/pressable-scale";
import { useScreenExit } from "@/lib/nav";
import { useTheme } from "@/lib/use-theme";

export function BackButton({
	onPress,
	variant = "default",
	disabled,
	testID
}: {
	// Defaults to leaving for the previous screen (or the list).
	onPress?: () => void;
	// "overlay" = light-on-dark, for buttons sitting over media (e.g. the camera).
	variant?: "default" | "overlay";
	disabled?: boolean;
	testID?: string;
}) {
	const theme = useTheme();
	// Guarded, so an impatient double-tap leaves once instead of popping the screen
	// underneath as well.
	const { leave } = useScreenExit();
	const overlay = variant === "overlay";
	return (
		<PressableScale
			testID={testID}
			accessibilityRole="button"
			accessibilityLabel="Back"
			disabled={disabled}
			hitSlop={8}
			onPress={() => {
				if (onPress) onPress();
				else leave();
			}}
			style={{
				width: 40,
				height: 40,
				borderRadius: 20,
				alignItems: "center",
				justifyContent: "center",
				opacity: disabled ? 0.35 : 1,
				...(overlay
					? { backgroundColor: "rgba(0,0,0,0.45)" }
					: { borderWidth: 1, borderColor: theme.border })
			}}
		>
			<ArrowLeft
				size={20}
				color={overlay ? "#ffffff" : theme.foreground}
				strokeWidth={2.2}
			/>
		</PressableScale>
	);
}
