import { type LucideIcon } from "lucide-react-native";
import { Modal, Pressable, Text, View } from "react-native";
import Animated, { SlideInDown } from "react-native-reanimated";
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

export function ActionSheet({
	visible,
	title,
	subtitle,
	actions,
	onClose
}: {
	visible: boolean;
	title?: string;
	subtitle?: string;
	actions: SheetAction[];
	onClose: () => void;
}) {
	const theme = useTheme();
	const insets = useSafeAreaInsets();

	return (
		<Modal
			visible={visible}
			transparent
			animationType="fade"
			onRequestClose={onClose}
			statusBarTranslucent
		>
			<Pressable
				style={{
					flex: 1,
					justifyContent: "flex-end",
					backgroundColor: "rgba(0,0,0,0.4)"
				}}
				onPress={onClose}
			>
				<Animated.View
					entering={SlideInDown.springify().damping(20).stiffness(220)}
				>
					{/* Swallow taps so they don't reach the backdrop and close it. */}
					<Pressable
						onPress={() => {}}
						style={{
							backgroundColor: theme.card,
							borderTopLeftRadius: 22,
							borderTopRightRadius: 22,
							borderColor: theme.border,
							borderWidth: 1,
							paddingTop: 8,
							paddingBottom: insets.bottom + 8
						}}
					>
						<View
							style={{
								alignSelf: "center",
								width: 36,
								height: 5,
								borderRadius: 999,
								backgroundColor: theme.border,
								marginBottom: title ? 10 : 6
							}}
						/>
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
											{
												fontSize: 13,
												color: theme.mutedForeground,
												marginTop: 2
											}
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
									scaleTo={0.97}
									onPress={() => {
										onClose();
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
					</Pressable>
				</Animated.View>
			</Pressable>
		</Modal>
	);
}
