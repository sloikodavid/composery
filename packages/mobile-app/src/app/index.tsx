import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
	ActivityIndicator,
	FlatList,
	Pressable,
	StyleSheet,
	Text,
	View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
	createInstanceStore,
	touch,
	type Instance
} from "@/lib/instance-store";
import { useTheme } from "@/lib/use-theme";

const store = createInstanceStore(AsyncStorage);

export default function IndexScreen() {
	const theme = useTheme();
	const [instances, setInstances] = useState<Instance[]>([]);
	const [loading, setLoading] = useState(true);

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
		// Optimistically record the open, then navigate. touch is pure; persist is fire-and-forget.
		const updated = touch(instances, instance.id);
		setInstances(updated);
		void store.persist(updated);
		router.push({ pathname: "/instance/[id]", params: { id: instance.id } });
	}

	function addInstance() {
		router.push("/add-instance");
	}

	const empty = !loading && instances.length === 0;

	return (
		<SafeAreaView
			edges={["top", "bottom"]}
			style={[styles.container, { backgroundColor: theme.background }]}
		>
			<View style={[styles.header, { borderBottomColor: theme.border }]}>
				<Text style={[styles.title, { color: theme.foreground }]}>
					Composery
				</Text>
				{!empty && (
					<Pressable
						testID="add-instance-button"
						onPress={addInstance}
						style={({ pressed }) => [
							styles.headerAdd,
							{ backgroundColor: theme.primary, opacity: pressed ? 0.7 : 1 }
						]}
					>
						<Text
							style={[styles.headerAddText, { color: theme.primaryForeground }]}
						>
							+
						</Text>
					</Pressable>
				)}
			</View>

			{loading ? (
				<View style={styles.center}>
					<ActivityIndicator color={theme.primary} />
				</View>
			) : empty ? (
				<View style={styles.center}>
					<View style={[styles.mark, { backgroundColor: theme.primary }]}>
						<Text style={[styles.markText, { color: theme.primaryForeground }]}>
							C
						</Text>
					</View>
					<Text style={[styles.emptyTitle, { color: theme.foreground }]}>
						Welcome to Composery
					</Text>
					<Text style={[styles.emptyBody, { color: theme.mutedForeground }]}>
						Add a Composery instance to get started — self-hosted or Cloud, just
						enter the URL.
					</Text>
					<Pressable
						testID="add-instance-button"
						onPress={addInstance}
						style={({ pressed }) => [
							styles.cta,
							{ backgroundColor: theme.primary, opacity: pressed ? 0.7 : 1 }
						]}
					>
						<Text style={[styles.ctaText, { color: theme.primaryForeground }]}>
							Add an instance
						</Text>
					</Pressable>
				</View>
			) : (
				<FlatList
					data={instances}
					keyExtractor={(item) => item.id}
					ItemSeparatorComponent={() => (
						<View
							style={[styles.separator, { backgroundColor: theme.border }]}
						/>
					)}
					renderItem={({ item }) => (
						<Pressable
							testID="instance-item"
							onPress={() => openInstance(item)}
							style={({ pressed }) => [
								styles.row,
								{
									backgroundColor: theme.background,
									opacity: pressed ? 0.5 : 1
								}
							]}
						>
							<Text
								style={[styles.rowLabel, { color: theme.foreground }]}
								numberOfLines={1}
							>
								{item.label}
							</Text>
							<Text
								style={[styles.rowUrl, { color: theme.mutedForeground }]}
								numberOfLines={1}
							>
								{item.url}
							</Text>
						</Pressable>
					)}
				/>
			)}
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		paddingHorizontal: 16,
		paddingVertical: 12,
		borderBottomWidth: 1
	},
	title: {
		fontSize: 22,
		fontWeight: "700"
	},
	headerAdd: {
		width: 32,
		height: 32,
		borderRadius: 16,
		alignItems: "center",
		justifyContent: "center"
	},
	headerAddText: {
		fontSize: 22,
		fontWeight: "600",
		marginTop: -2
	},
	center: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		paddingHorizontal: 32,
		gap: 12
	},
	mark: {
		width: 72,
		height: 72,
		borderRadius: 18,
		alignItems: "center",
		justifyContent: "center",
		marginBottom: 8
	},
	markText: {
		fontSize: 40,
		fontWeight: "700"
	},
	emptyTitle: {
		fontSize: 20,
		fontWeight: "700",
		textAlign: "center"
	},
	emptyBody: {
		fontSize: 15,
		textAlign: "center",
		lineHeight: 21
	},
	cta: {
		paddingHorizontal: 20,
		paddingVertical: 12,
		borderRadius: 10,
		marginTop: 8
	},
	ctaText: {
		fontSize: 16,
		fontWeight: "600"
	},
	row: {
		paddingHorizontal: 16,
		paddingVertical: 14
	},
	rowLabel: {
		fontSize: 16,
		fontWeight: "600"
	},
	rowUrl: {
		fontSize: 13,
		marginTop: 2
	},
	separator: {
		height: 1,
		marginLeft: 16
	}
});
