import {
	BottomSheetBackdrop,
	type BottomSheetBackdropProps,
	BottomSheetModal,
	BottomSheetView
} from "@gorhom/bottom-sheet";
import { type LucideIcon } from "lucide-react-native";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PressableScale } from "@/components/pressable-scale";
import { body, heading } from "@/lib/fonts";
import { useTheme } from "@/lib/use-theme";

export type SheetAction = {
	label: string;
	icon: LucideIcon;
	onPress: () => void;
	destructive?: boolean;
};

// Imperative handle: callers present()/dismiss() directly from the event that
// opens the menu. Driving the sheet from a `visible` prop + useEffect breaks
// under Strict Mode / React Compiler, which double-invoke effects and race
// gorhom's present() (see gorhom/react-native-bottom-sheet#2155).
export type ActionSheetRef = {
	present: () => void;
	dismiss: () => void;
};

export const ActionSheet = forwardRef<
	ActionSheetRef,
	{
		title?: string;
		subtitle?: string;
		actions: SheetAction[];
		onClose: () => void;
	}
>(function ActionSheet({ title, subtitle, actions, onClose }, ref) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();
	const sheet = useRef<BottomSheetModal>(null);

	useImperativeHandle(
		ref,
		() => ({
			present: () => sheet.current?.present(),
			dismiss: () => sheet.current?.dismiss()
		}),
		[]
	);

	const renderBackdrop = useCallback(
		(props: BottomSheetBackdropProps) => (
			<BottomSheetBackdrop
				{...props}
				appearsOnIndex={0}
				disappearsOnIndex={-1}
				opacity={0.4}
				pressBehavior="close"
			/>
		),
		[]
	);

	return (
		<BottomSheetModal
			ref={sheet}
			enableDynamicSizing
			enablePanDownToClose
			onDismiss={onClose}
			backdropComponent={renderBackdrop}
			handleIndicatorStyle={{ backgroundColor: theme.border }}
			backgroundStyle={{ backgroundColor: theme.card, borderRadius: 22 }}
		>
			<BottomSheetView style={{ paddingBottom: insets.bottom + 8 }}>
				{title ? (
					<View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
						<Text
							style={[
								heading("semibold"),
								{ fontSize: 17, color: theme.foreground }
							]}
							numberOfLines={1}
						>
							{title}
						</Text>
						{subtitle ? (
							<Text
								style={[
									body(),
									{ fontSize: 13, color: theme.mutedForeground, marginTop: 2 }
								]}
								numberOfLines={1}
							>
								{subtitle}
							</Text>
						) : null}
					</View>
				) : null}
				{actions.map((action) => {
					const Icon = action.icon;
					const color = action.destructive
						? theme.destructive
						: theme.foreground;
					return (
						<PressableScale
							key={action.label}
							accessibilityRole="button"
							accessibilityLabel={action.label}
							scaleTo={0.97}
							onPress={() => {
								sheet.current?.dismiss();
								action.onPress();
							}}
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: 14,
								paddingHorizontal: 20,
								paddingVertical: 14
							}}
						>
							<Icon size={20} color={color} strokeWidth={2} />
							<Text style={[body("medium"), { fontSize: 16, color }]}>
								{action.label}
							</Text>
						</PressableScale>
					);
				})}
			</BottomSheetView>
		</BottomSheetModal>
	);
});
