import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	ActivityIndicator,
	Alert,
	BackHandler,
	Pressable,
	StyleSheet,
	Text,
	View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import WebView, { type WebViewNavigation } from "react-native-webview";

import {
	createInstanceStore,
	get,
	remove,
	type Instance
} from "@/lib/instance-store";
import { useTheme } from "@/lib/use-theme";

const store = createInstanceStore(AsyncStorage);

export default function InstanceScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const theme = useTheme();
	const [instance, setInstance] = useState<Instance | undefined>();
	const [loading, setLoading] = useState(true);
	const [canGoBack, setCanGoBack] = useState(false);
	const webviewRef = useRef<WebView>(null);

	// Load the instance by id. The list touches lastOpenedAt on tap; this screen
	// only reads (it does not own the open timestamp).
	useEffect(() => {
		let active = true;
		store.loadAll().then((list) => {
			if (active) {
				setInstance(get(list, id));
				setLoading(false);
			}
		});
		return () => {
			active = false;
		};
	}, [id]);

	// The instance's own origin; cross-origin top-frame navigations are handed
	// off to the system browser. Empty until the instance is loaded, in which
	// case the WebView is not rendered yet anyway.
	const instanceOrigin = instance ? new URL(instance.url).origin : "";

	const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
		setCanGoBack(nav.canGoBack);
	}, []);

	// Android hardware back: go back inside the WebView when possible, else pop
	// to the list (return false lets the navigator handle it).
	useEffect(() => {
		const onBack = (): boolean => {
			if (canGoBack && webviewRef.current) {
				webviewRef.current.goBack();
				return true;
			}
			return false;
		};
		const subscription = BackHandler.addEventListener(
			"hardwareBackPress",
			onBack
		);
		return () => subscription.remove();
	}, [canGoBack]);

	const renderLoading = useCallback(
		() => (
			<View style={[styles.loading, { backgroundColor: theme.background }]}>
				<ActivityIndicator color={theme.primary} size="large" />
			</View>
		),
		[theme.background, theme.primary]
	);

	async function removeInstance() {
		if (!id) return;
		const list = await store.loadAll();
		await store.persist(remove(list, id));
		router.back();
	}

	function openMenu() {
		if (!instance) return;
		// Three buttons max — Android's Alert ignores a fourth.
		Alert.alert(instance.label, undefined, [
			{ text: "Reload", onPress: () => webviewRef.current?.reload() },
			{
				text: "Open in browser",
				onPress: () => void openBrowserAsync(instance.url)
			},
			{
				text: "Remove",
				style: "destructive",
				onPress: () => void removeInstance()
			}
		]);
	}

	return (
		<SafeAreaView
			edges={["top"]}
			style={[styles.container, { backgroundColor: theme.background }]}
		>
			<View style={[styles.topbar, { borderBottomColor: theme.border }]}>
				<Pressable
					testID="instance-back"
					onPress={() => router.back()}
					hitSlop={12}
					style={styles.topbarButton}
				>
					<Text style={[styles.topbarAction, { color: theme.primary }]}>←</Text>
				</Pressable>
				<Text
					style={[styles.topbarTitle, { color: theme.foreground }]}
					numberOfLines={1}
				>
					{instance?.label ?? "Instance"}
				</Text>
				<Pressable
					testID="instance-menu"
					onPress={openMenu}
					hitSlop={12}
					style={styles.topbarButton}
					disabled={!instance}
				>
					<Text
						style={[
							styles.topbarAction,
							{ color: instance ? theme.primary : theme.mutedForeground }
						]}
					>
						⋯
					</Text>
				</Pressable>
			</View>

			{loading ? (
				<View style={styles.center}>
					<ActivityIndicator color={theme.primary} size="large" />
				</View>
			) : !instance ? (
				<View style={styles.center}>
					<Text style={[styles.missing, { color: theme.foreground }]}>
						Instance not found
					</Text>
					<Pressable
						testID="instance-back-missing"
						onPress={() => router.back()}
						style={({ pressed }) => [
							styles.missingBack,
							{ opacity: pressed ? 0.5 : 1 }
						]}
					>
						<Text style={{ color: theme.primary }}>Back to list</Text>
					</Pressable>
				</View>
			) : (
				<WebView
					ref={webviewRef}
					source={{ uri: instance.url }}
					// Cookie props: iOS uses WKHTTPCookieStore, Android uses CookieManager.
					// Composery's `code-server-session` is a session cookie (no Max-Age), so
					// Android persists it across app-kills but iOS drops it on a full kill —
					// the user re-enters the password after an iOS hard kill. v1 accepts this
					// (matches browser semantics); restoring it needs @react-native-cookies/
					// cookies, which forces a dev build and is out of scope (PLAN.md).
					sharedCookiesEnabled
					thirdPartyCookiesEnabled
					javaScriptEnabled
					domStorageEnabled
					startInLoadingState
					renderLoading={renderLoading}
					onShouldStartLoadWithRequest={(request) => {
						// Navigation guard (PLAN.md Wrinkle 6). iOS fires this for the initial
						// main-frame load too, so a naive "block anything off-host" guard
						// blanks the first paint. navigationType 'other' covers the initial
						// load AND sub-frame/resource requests (CDNs, fonts, iframes) — allow
						// all of those. Only user-driven top-frame navigations to a different
						// host are intercepted and sent to the system browser; Android's
						// isTopFrame tells sub-frame clicks apart, iOS does not (a non-'other'
						// navigation is a top-frame link there).
						if (request.navigationType === "other") return true;
						let parsed: URL;
						try {
							parsed = new URL(request.url);
						} catch {
							return true;
						}
						if (parsed.origin === instanceOrigin) return true;
						if (request.isTopFrame === false) return true;
						void openBrowserAsync(request.url);
						return false;
					}}
					onNavigationStateChange={onNavigationStateChange}
					testID="instance-webview"
					style={styles.webview}
				/>
			)}
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1
	},
	topbar: {
		flexDirection: "row",
		alignItems: "center",
		height: 44,
		paddingHorizontal: 8,
		borderBottomWidth: 1
	},
	topbarButton: {
		width: 40,
		height: 40,
		alignItems: "center",
		justifyContent: "center"
	},
	topbarAction: {
		fontSize: 22,
		fontWeight: "500"
	},
	topbarTitle: {
		flex: 1,
		fontSize: 16,
		fontWeight: "600",
		textAlign: "center",
		marginHorizontal: 4
	},
	center: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		gap: 12
	},
	missing: {
		fontSize: 16,
		fontWeight: "600"
	},
	missingBack: {
		paddingHorizontal: 16,
		paddingVertical: 8
	},
	loading: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center"
	},
	webview: {
		flex: 1
	}
});
