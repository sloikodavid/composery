// Arc spinner: a faint full track plus a rotating ~28% arc, brand-colored and
// identical on iOS and Android (the platform ActivityIndicator is neither).
import { useEffect } from "react";
import Animated, {
	cancelAnimation,
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withRepeat,
	withTiming
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

export function Spinner({
	size = 28,
	color,
	strokeWidth = 3
}: {
	size?: number;
	color: string;
	strokeWidth?: number;
}) {
	const rotation = useSharedValue(0);

	useEffect(() => {
		rotation.set(
			withRepeat(
				withTiming(360, { duration: 850, easing: Easing.linear }),
				-1,
				false
			)
		);
		return () => cancelAnimation(rotation);
	}, [rotation]);

	const animatedStyle = useAnimatedStyle(() => ({
		transform: [{ rotate: `${rotation.get()}deg` }]
	}));

	const radius = (size - strokeWidth) / 2;
	const circumference = 2 * Math.PI * radius;

	return (
		<Animated.View style={[{ width: size, height: size }, animatedStyle]}>
			<Svg width={size} height={size}>
				<Circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					stroke={color}
					strokeWidth={strokeWidth}
					fill="none"
					opacity={0.16}
				/>
				<Circle
					cx={size / 2}
					cy={size / 2}
					r={radius}
					stroke={color}
					strokeWidth={strokeWidth}
					strokeLinecap="round"
					fill="none"
					strokeDasharray={`${circumference * 0.28} ${circumference}`}
				/>
			</Svg>
		</Animated.View>
	);
}
