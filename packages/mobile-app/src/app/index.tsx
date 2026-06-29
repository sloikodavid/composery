import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import {
	EllipsisVertical,
	ExternalLink,
	Plus,
	QrCode,
	RotateCw,
	SquarePen,
	Trash2
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Text, View } from "react-native";
import Animated, {
	FadeIn,
	FadeInDown,
	useAnimatedStyle,
	useSharedValue,
	withTiming
} from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import {
	ActionSheet,
	type ActionSheetRef,
	type SheetAction
} from "@/components/action-sheet";
import { Logo, LogoMark } from "@/components/logo";
import { PressableScale } from "@/components/pressable-scale";
import { Spinner } from "@/components/spinner";
import { body, heading } from "@/lib/fonts";
import { errorFeedback } from "@/lib/haptics";
import { createInstanceStore, type Instance } from "@/lib/instance-store";
import { useTheme, type Theme } from "@/lib/use-theme";

const store = createInstanceStore(AsyncStorage);

export default function IndexScreen() {
	const theme = useTheme();
	const [instances, setInstances] = useState<Instance[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [menuFor, setMenuFor] = useState<Instance | null>(null);
	const sheetRef = useRef<ActionSheetRef>(null);

	// Set the target, then open the sheet imperatively (the gorhom-supported path;
	// a declarative visible-prop bridge races present() under React Compiler).
	function openMenu(instance: Instance) {
		setMenuFor(instance);
		sheetRef.current?.present();
	}
	// A header separator fades in once the list is scrolled off the top.
	const [scrolled, setScrolled] = useState(false);
	const sepOpacity = useSharedValue(0);
	useEffect(() => {
		sepOpacity.set(withTiming(scrolled ? 1 : 0, { duration: 200 }));
	}, [scrolled, sepOpacity]);
	const sepStyle = useAnimatedStyle(() => ({ opacity: sepOpacity.get() }));

	const loadInstances = useCallback((isActive: () => boolean = () => true) => {
		setLoading(true);
		setLoadError(null);
		store
			.loadAll()
			.then((list) => {
				if (!isActive()) return;
				setInstances(list);
				setLoading(false);
			})
			.catch((err) => {
				if (!isActive()) return;
				setLoadError(
					err instanceof Error ? err.message : "Could not load instances."
				);
				setLoading(false);
			});
	}, []);

	useFocusEffect(
		useCallback(() => {
			let active = true;
			loadInstances(() => active);
			return () => {
				active = false;
			};
		}, [loadInstances])
	);

	function openInstance(instance: Instance) {
		void store
			.touch(instance.id)
			.then(setInstances)
			.catch(() => undefined);
		router.push({ pathname: "/instance/[id]", params: { id: instance.id } });
	}

	function editInstance(instance: Instance) {
		router.push({ pathname: "/add-instance", params: { id: instance.id } });
	}

	async function removeInstance(instance: Instance) {
		errorFeedback();
		try {
			setInstances(await store.remove(instance.id));
		} catch (err) {
			setLoadError(
				err instanceof Error ? err.message : "Could not remove instance."
			);
		}
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
							onPress={() => void openBrowserAsync("https://www.composery.io")}
						>
							<Logo height={26} color={theme.foreground} />
						</PressableScale>
						<View
							style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
						>
							<PressableScale
								testID="scan-button"
								accessibilityRole="button"
								accessibilityLabel="Scan QR code"
								onPress={() => router.push("/scan")}
								style={{
									width: 40,
									height: 40,
									borderRadius: 20,
									borderWidth: 1,
									borderColor: theme.border,
									alignItems: "center",
									justifyContent: "center"
								}}
							>
								<QrCode size={20} color={theme.foreground} strokeWidth={2.2} />
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
			) : loadError ? (
				<ErrorState
					theme={theme}
					title="Couldn't load instances"
					detail={loadError}
					onRetry={() => loadInstances()}
				/>
			) : empty ? (
				<EmptyState
					theme={theme}
					onAdd={() => router.push("/add-instance")}
					onScan={() => router.push("/scan")}
				/>
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
							onMenu={() => openMenu(item)}
						/>
					)}
				/>
			)}

			<ActionSheet
				ref={sheetRef}
				title={menuFor?.label || menuFor?.url}
				actions={menuActions}
				onClose={() => setMenuFor(null)}
			/>
		</SafeAreaView>
	);
}

function ErrorState({
	theme,
	title,
	detail,
	onRetry
}: {
	theme: Theme;
	title: string;
	detail: string;
	onRetry: () => void;
}) {
	return (
		<View style={styles_empty}>
			<Text
				style={[heading("bold"), { fontSize: 20, color: theme.foreground }]}
			>
				{title}
			</Text>
			<Text
				style={[
					body(),
					{
						fontSize: 14,
						lineHeight: 20,
						textAlign: "center",
						color: theme.mutedForeground,
						marginTop: 8
					}
				]}
			>
				{detail}
			</Text>
			<PressableScale
				accessibilityRole="button"
				accessibilityLabel="Retry"
				onPress={onRetry}
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					paddingHorizontal: 18,
					paddingVertical: 12,
					borderRadius: 12,
					backgroundColor: theme.primary,
					marginTop: 24
				}}
			>
				<RotateCw size={16} color={theme.primaryForeground} strokeWidth={2.4} />
				<Text
					style={[
						body("semibold"),
						{ fontSize: 15, color: theme.primaryForeground }
					]}
				>
					Retry
				</Text>
			</PressableScale>
		</View>
	);
}

function InstanceRow({
	instance,
	index,
	theme,
	onOpen,
	onMenu
}: {
	instance: Instance;
	index: number;
	theme: Theme;
	onOpen: () => void;
	onMenu: () => void;
}) {
	return (
		<Animated.View
			entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(260)}
		>
			<View style={{ flexDirection: "row", alignItems: "center" }}>
				<PressableScale
					testID="instance-item"
					scaleTo={0.98}
					onPress={onOpen}
					onLongPress={onMenu}
					style={{
						flex: 1,
						backgroundColor: theme.background,
						paddingLeft: 16,
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
				<PressableScale
					testID="instance-menu-button"
					accessibilityRole="button"
					accessibilityLabel="Instance actions"
					scaleTo={0.9}
					onPress={onMenu}
					hitSlop={6}
					style={{
						width: 44,
						height: 44,
						marginRight: 6,
						alignItems: "center",
						justifyContent: "center"
					}}
				>
					<EllipsisVertical
						size={20}
						color={theme.mutedForeground}
						strokeWidth={2}
					/>
				</PressableScale>
			</View>
			<View
				style={{ height: 1, marginLeft: 16, backgroundColor: theme.border }}
			/>
		</Animated.View>
	);
}

function EmptyState({
	theme,
	onAdd,
	onScan
}: {
	theme: Theme;
	onAdd: () => void;
	onScan: () => void;
}) {
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
				Add your Composery by URL - Cloud or self-hosted.
			</Text>
			<PressableScale
				testID="add-instance-button"
				accessibilityRole="button"
				accessibilityLabel="Add instance"
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
			<PressableScale
				testID="scan-button"
				accessibilityRole="button"
				accessibilityLabel="Scan QR code"
				onPress={onScan}
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					paddingHorizontal: 20,
					paddingVertical: 12,
					marginTop: 4
				}}
			>
				<QrCode size={18} color={theme.primary} strokeWidth={2.2} />
				<Text
					style={[body("semibold"), { fontSize: 15, color: theme.primary }]}
				>
					Scan QR code
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
