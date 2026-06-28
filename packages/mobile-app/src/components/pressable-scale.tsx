// Pressable that dips in scale and fires a light haptic on press — the app's one
// source of "this is tappable" feedback, so the feel stays consistent.
import { type ReactNode } from "react";
import {
	Pressable,
	type GestureResponderEvent,
	type PressableProps,
	type StyleProp,
	type ViewStyle
} from "react-native";
import Animated, {
	useAnimatedStyle,
	useSharedValue,
	withTiming
} from "react-native-reanimated";

import { tapFeedback } from "@/lib/haptics";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, "style"> & {
	children: ReactNode;
	style?: StyleProp<ViewStyle>;
	scaleTo?: number;
	haptic?: boolean;
};

export function PressableScale({
	children,
	style,
	scaleTo = 0.94,
	haptic = true,
	onPress,
	onPressIn,
	onPressOut,
	...props
}: Props) {
	const scale = useSharedValue(1);
	const animatedStyle = useAnimatedStyle(() => ({
		transform: [{ scale: scale.get() }]
	}));

	return (
		<AnimatedPressable
			{...props}
			onPressIn={(event: GestureResponderEvent) => {
				scale.set(withTiming(scaleTo, { duration: 90 }));
				onPressIn?.(event);
			}}
			onPressOut={(event: GestureResponderEvent) => {
				scale.set(withTiming(1, { duration: 140 }));
				onPressOut?.(event);
			}}
			onPress={(event: GestureResponderEvent) => {
				if (haptic) tapFeedback();
				onPress?.(event);
			}}
			style={[style, animatedStyle]}
		>
			{children}
		</AnimatedPressable>
	);
}
