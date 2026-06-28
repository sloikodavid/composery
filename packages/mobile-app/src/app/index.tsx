import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { ExternalLink, Plus, SquarePen, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import Animated, {
	FadeIn,
	FadeInDown,
	useAnimatedStyle,
	useSharedValue,
	withTiming
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import { ActionSheet, type SheetAction } from "@/components/action-sheet";
import { Logo, LogoMark } from "@/components/logo";
import { PressableScale } from "@/components/pressable-scale";
import { Spinner } from "@/components/spinner";
import { body, heading } from "@/lib/fonts";
import { errorFeedback, selectFeedback } from "@/lib/haptics";
import {
	createInstanceStore,
	remove,
	touch,
	type Instance
} from "@/lib/instance-store";
import { useTheme, type Theme } from "@/lib/use-theme";

const store = createInstanceStore(AsyncStorage);

export default function IndexScreen() {
	const theme = useTheme();
	const [instances, setInstances] = useState<Instance[]>([]);
	const [loading, setLoading] = useState(true);
	const [menuFor, setMenuFor] = useState<Instance | null>(null);
	// A header separator fades in once the list is scrolled off the top.
	const [scrolled, setScrolled] = useState(false);
	const sepOpacity = useSharedValue(0);
	useEffect(() => {
		sepOpacity.set(withTiming(scrolled ? 1 : 0, { duration: 200 }));
	}, [scrolled, sepOpacity]);
	const sepStyle = useAnimatedStyle(() => ({ opacity: sepOpacity.get() }));

	useFocusEffect(
		useCallback(() => {
			let active = true;
			store.loadAll().then((list) => {
				if (active) {
					setInstances(list);
					setLoading(false);
				}
			});
			return () => {
				active = false;
			};
		}, [])
	);

	function openInstance(instance: Instance) {
		// Optimistically record the open, then navigate; persist is fire-and-forget.
		const updated = touch(instances, instance.id);
		setInstances(updated);
		void store.persist(updated);
		router.push({ pathname: "/instance/[id]", params: { id: instance.id } });
	}

	function editInstance(instance: Instance) {
		router.push({ pathname: "/add-instance", params: { id: instance.id } });
	}

	async function removeInstance(instance: Instance) {
		errorFeedback();
		const next = remove(instances, instance.id);
		setInstances(next);
		await store.persist(next);
	}

	const menuActions: SheetAction[] = menuFor
		? [
				{
					label: "Open in browser",
					icon: ExternalLink,
					onPress: () => void openBrowserAsync(menuFor.url)
				},
				{
					label: "Edit",
					icon: SquarePen,
					onPress: () => editInstance(menuFor)
				},
				{
					label: "Remove",
					icon: Trash2,
					destructive: true,
					onPress: () => void removeInstance(menuFor)
				}
			]
		: [];

	const empty = !loading && instances.length === 0;

	return (
		<SafeAreaView
			edges={["top", "bottom"]}
			style={{ flex: 1, backgroundColor: theme.background }}
		>
			{!empty && (
				<>
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							justifyContent: "space-between",
							paddingHorizontal: 16,
							paddingTop: 8,
							paddingBottom: 12
						}}
					>
						<PressableScale
							accessibilityRole="link"
							accessibilityLabel="Composery website"
							scaleTo={0.96}
							onPress={() => void openBrowserAsync("https://composery.io")}
						>
							<Logo height={26} color={theme.foreground} />
						</PressableScale>
						<PressableScale
							testID="add-instance-button"
							accessibilityRole="button"
							accessibilityLabel="Add instance"
							onPress={() => router.push("/add-instance")}
							style={{
								width: 40,
								height: 40,
								borderRadius: 20,
								backgroundColor: theme.primary,
								alignItems: "center",
								justifyContent: "center"
							}}
						>
							<Plus
								size={22}
								color={theme.primaryForeground}
								strokeWidth={2.4}
							/>
						</PressableScale>
					</View>
					<Animated.View
						style={[
							{
								height: 1,
								marginHorizontal: 16,
								backgroundColor: theme.border
							},
							sepStyle
						]}
					/>
				</>
			)}

			{loading ? (
				<View style={styles_center}>
					<Spinner color={theme.primary} size={30} />
				</View>
			) : empty ? (
				<EmptyState theme={theme} onAdd={() => router.push("/add-instance")} />
			) : (
				<FlatList
					data={instances}
					keyExtractor={(item) => item.id}
					contentContainerStyle={{ paddingBottom: 24 }}
					scrollEventThrottle={16}
					onScroll={(e) => setScrolled(e.nativeEvent.contentOffset.y > 0)}
					renderItem={({ item, index }) => (
						<InstanceRow
							instance={item}
							index={index}
							theme={theme}
							onOpen={() => openInstance(item)}
							onEdit={() => editInstance(item)}
							onRemove={() => void removeInstance(item)}
							onMenu={() => setMenuFor(item)}
						/>
					)}
				/>
			)}

			<ActionSheet
				visible={menuFor !== null}
				title={menuFor?.label || menuFor?.url}
				actions={menuActions}
				onClose={() => setMenuFor(null)}
			/>
		</SafeAreaView>
	);
}

function InstanceRow({
	instance,
	index,
	theme,
	onOpen,
	onEdit,
	onRemove,
	onMenu
}: {
	instance: Instance;
	index: number;
	theme: Theme;
	onOpen: () => void;
	onEdit: () => void;
	onRemove: () => void;
	onMenu: () => void;
}) {
	return (
		<Animated.View
			entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(260)}
		>
			<ReanimatedSwipeable
				friction={2}
				rightThreshold={44}
				overshootRight={false}
				onSwipeableOpen={() => selectFeedback()}
				renderRightActions={(_progress, _translation, methods) => (
					<View style={{ flexDirection: "row" }}>
						<SwipeAction
							label="Edit"
							icon={SquarePen}
							background={SWIPE_EDIT_BG}
							onPress={() => {
								methods.close();
								onEdit();
							}}
						/>
						<SwipeAction
							label="Remove"
							icon={Trash2}
							background={SWIPE_REMOVE_BG}
							onPress={() => {
								methods.close();
								onRemove();
							}}
						/>
					</View>
				)}
			>
				<PressableScale
					testID="instance-item"
					scaleTo={0.98}
					onPress={onOpen}
					onLongPress={onMenu}
					style={{
						backgroundColor: theme.background,
						paddingHorizontal: 16,
						paddingVertical: 16
					}}
				>
					<Text
						style={[
							body("semibold"),
							{ fontSize: 16, color: theme.foreground }
						]}
						numberOfLines={1}
					>
						{instance.label || instance.url}
					</Text>
				</PressableScale>
			</ReanimatedSwipeable>
			<View
				style={{ height: 1, marginLeft: 16, backgroundColor: theme.border }}
			/>
		</Animated.View>
	);
}

// Fixed across light/dark, like iOS swipe actions: warm grey for Edit, red for
// Remove. White content reads on both.
const SWIPE_EDIT_BG = "#78716c";
const SWIPE_REMOVE_BG = "#dc2626";

function SwipeAction({
	label,
	icon: Icon,
	background,
	onPress
}: {
	label: string;
	icon: typeof SquarePen;
	background: string;
	onPress: () => void;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			style={({ pressed }) => ({
				width: 78,
				backgroundColor: background,
				alignItems: "center",
				justifyContent: "center",
				gap: 5,
				opacity: pressed ? 0.85 : 1
			})}
		>
			<Icon size={20} color="#ffffff" strokeWidth={2} />
			<Text style={[body("medium"), { fontSize: 13, color: "#ffffff" }]}>
				{label}
			</Text>
		</Pressable>
	);
}

function EmptyState({ theme, onAdd }: { theme: Theme; onAdd: () => void }) {
	return (
		<Animated.View entering={FadeIn.duration(300)} style={styles_empty}>
			<LogoMark size={64} />
			<Text
				style={[
					heading("bold"),
					{ fontSize: 24, color: theme.foreground, marginTop: 16 }
				]}
			>
				No instances yet
			</Text>
			<Text
				style={[
					body(),
					{
						fontSize: 15,
						lineHeight: 22,
						textAlign: "center",
						color: theme.mutedForeground,
						marginTop: 6
					}
				]}
			>
				Add your Composery by URL — self-hosted or Cloud.
			</Text>
			<PressableScale
				testID="add-instance-button"
				accessibilityRole="button"
				onPress={onAdd}
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					backgroundColor: theme.primary,
					paddingHorizontal: 20,
					paddingVertical: 13,
					borderRadius: 12,
					marginTop: 24
				}}
			>
				<Plus size={18} color={theme.primaryForeground} strokeWidth={2.4} />
				<Text
					style={[
						body("semibold"),
						{ fontSize: 16, color: theme.primaryForeground }
					]}
				>
					Add instance
				</Text>
			</PressableScale>
		</Animated.View>
	);
}

const styles_center = {
	flex: 1,
	alignItems: "center",
	justifyContent: "center"
} as const;

const styles_empty = {
	flex: 1,
	alignItems: "center",
	justifyContent: "center",
	paddingHorizontal: 32
} as const;
