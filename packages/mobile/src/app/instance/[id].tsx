import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { openBrowserAsync } from "expo-web-browser";
import { RotateCw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Text, useColorScheme, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView, { type WebViewNavigation } from "react-native-webview";

import { BackButton } from "@/components/back-button";
import { PressableScale } from "@/components/pressable-scale";
import { Spinner } from "@/components/spinner";
import { body, heading } from "@/lib/fonts";
import { createInstanceStore, type Instance } from "@/lib/instance-store";
import { probeComposery, type ProbeResult } from "@/lib/probe";
import { useTheme } from "@/lib/use-theme";
import { buildBeforeLoad, INSTALL_SCRIPT } from "@/web/back-button";

const store = createInstanceStore(AsyncStorage);
type FailedProbe = Extract<ProbeResult, { ok: false }>;

// Light vs dark status-bar icons for a given strip color (relative luminance).
function isLight(color: string): boolean {
	const rgb = color.match(/\d+(\.\d+)?/g);
	if (!rgb || rgb.length < 3) return true;
	const [r, g, b] = rgb.map(Number);
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

export default function InstanceScreen() {
	const { id } = useLocalSearchParams<{ id: string }>();
	const theme = useTheme();
	const scheme = useColorScheme();
	const insets = useSafeAreaInsets();
	const [instance, setInstance] = useState<Instance | undefined>();
	const [loading, setLoading] = useState(true);
	const [storageError, setStorageError] = useState<string | null>(null);
	// probeResult stores the result keyed by `${url}:${reloadKey}`. When the
	// key doesn't match the current url+reloadKey, the probe is in-flight and
	// the derived `probe` value reads as "probing" — no setState in the effect
	// body, which the React Compiler / lint flags as a cascading render.
	const [probeResult, setProbeResult] = useState<{
		key: string;
		result: ProbeResult;
	} | null>(null);
	const [webLoading, setWebLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const [canGoBack, setCanGoBack] = useState(false);
	// Live title-bar background reported by the page, so the status-bar strip
	// matches whatever IDE theme the user runs.
	const [stripColor, setStripColor] = useState<string | null>(null);
	const webviewRef = useRef<WebView>(null);

	const loadInstance = useCallback(
		(isActive: () => boolean = () => true) => {
			setLoading(true);
			setStorageError(null);
			setInstance(undefined);
			store
				.get(id)
				.then((instance) => {
					if (!isActive()) return;
					setInstance(instance);
					setLoading(false);
				})
				.catch((err) => {
					if (!isActive()) return;
					setStorageError(
						err instanceof Error ? err.message : "Could not load instances."
					);
					setLoading(false);
				});
		},
		[id]
	);

	useFocusEffect(
		useCallback(() => {
			let active = true;
			loadInstance(() => active);
			return () => {
				active = false;
			};
		}, [loadInstance])
	);

	// Probe the instance before mounting the WebView. A non-Composery URL is
	// rejected with an error screen instead of a blank embed. Re-runs on retry
	// (reloadKey) and when switching to a different instance.
	useEffect(() => {
		const url = instance?.url;
		if (!url) return;
		let active = true;
		const key = `${url}:${reloadKey}`;
		void probeComposery(url).then((result) => {
			if (!active) return;
			setProbeResult({ key, result });
			if (result.ok) setWebLoading(true);
		});
		return () => {
			active = false;
		};
	}, [instance?.url, reloadKey]);

	const messageBack = useCallback(() => {
		if (canGoBack && webviewRef.current) {
			webviewRef.current.goBack();
		} else {
			router.back();
		}
	}, [canGoBack]);

	useEffect(() => {
		const onBack = () => {
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

	const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
		setCanGoBack(nav.canGoBack);
	}, []);

	// When the system scheme flips while open, tell the page so code-server
	// re-detects its theme without a reload.
	useEffect(() => {
		webviewRef.current?.injectJavaScript(
			`window.__composerySetScheme && window.__composerySetScheme(${JSON.stringify(
				scheme === "dark" ? "dark" : "light"
			)}); true;`
		);
	}, [scheme]);

	function retry() {
		setLoadError(null);
		setWebLoading(true);
		setStripColor(null);
		setReloadKey((k) => k + 1);
	}

	const beforeLoad = useMemo(
		() => buildBeforeLoad(scheme === "dark" ? "dark" : "light"),
		[scheme]
	);
	const instanceOrigin = instance ? new URL(instance.url).origin : "";
	const probeKey = instance ? `${instance.url}:${reloadKey}` : "";
	const probe: ProbeResult | "probing" =
		probeResult?.key === probeKey ? probeResult.result : "probing";
	const failedProbe: FailedProbe | null =
		probe !== "probing" && !probe.ok ? probe : null;
	const probeOk = probe !== "probing" && probe.ok;
	const stripBg = stripColor ?? theme.background;
	const statusStyle = stripColor
		? isLight(stripColor)
			? "dark"
			: "light"
		: scheme === "dark"
			? "light"
			: "dark";

	return (
		<View style={{ flex: 1, backgroundColor: theme.background }}>
			<StatusBar style={statusStyle} />
			{/* Status-bar strip, tinted to the IDE title bar so the two read as one. */}
			<View style={{ height: insets.top, backgroundColor: stripBg }} />

			{storageError && !loading ? (
				<ErrorView
					theme={theme}
					title="Couldn't load instances"
					detail={storageError}
					onBack={() => router.back()}
					onRetry={() => loadInstance()}
				/>
			) : !instance && !loading ? (
				<ErrorView
					theme={theme}
					title="Instance not found"
					detail="It may have been removed."
					onBack={() => router.back()}
				/>
			) : instance && probe === "probing" ? (
				<View style={styles_center}>
					<Spinner color={theme.primary} size={32} />
				</View>
			) : instance && failedProbe ? (
				<ErrorView
					theme={theme}
					title={
						failedProbe.reason === "not-composery"
							? "This isn't a Composery"
							: "Couldn't reach this instance"
					}
					detail={
						failedProbe.reason === "not-composery"
							? `${instance.url}\ndoesn't point to a Composery instance.`
							: `${instance.url}\n${failedProbe.message}`
					}
					onBack={() => router.back()}
					onRetry={retry}
				/>
			) : instance && probeOk && loadError ? (
				<ErrorView
					theme={theme}
					title="Couldn't load this instance"
					detail={`${instance.url}\n${loadError}`}
					onBack={() => router.back()}
					onRetry={retry}
				/>
			) : instance && probeOk ? (
				<View style={{ flex: 1 }}>
					<WebView
						key={reloadKey}
						ref={webviewRef}
						source={{ uri: instance.url }}
						// White (the browser's default canvas) so a transparent-body page —
						// e.g. an upstream Cloudflare/origin error page — renders as it
						// would in a desktop browser, not with the theme bleeding through.
						// The load flash is hidden by the overlay below, not this colour.
						style={{ flex: 1, backgroundColor: "#ffffff" }}
						// iOS uses WKHTTPCookieStore, Android CookieManager.
						sharedCookiesEnabled
						thirdPartyCookiesEnabled
						javaScriptEnabled
						domStorageEnabled
						injectedJavaScriptBeforeContentLoaded={beforeLoad}
						injectedJavaScript={INSTALL_SCRIPT}
						onMessage={(event) => {
							const data = event.nativeEvent.data;
							if (data === "composery:back") messageBack();
							else if (data.startsWith("composery:bg:")) {
								setStripColor(data.slice("composery:bg:".length));
							}
						}}
						onLoadEnd={() => setWebLoading(false)}
						onError={(event) =>
							setLoadError(event.nativeEvent.description || "")
						}
						onNavigationStateChange={onNavigationStateChange}
						onShouldStartLoadWithRequest={(request) => {
							// Navigation guard (PLAN.md Wrinkle 6): 'other' covers the initial
							// load and sub-frame/resource requests — allow all. Only
							// user-driven top-frame nav to a different host opens the browser.
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
						testID="instance-webview"
					/>

					{/* Loading overlay: absolute, so it never reflows the WebView. */}
					{webLoading ? (
						<View pointerEvents="none" style={styles_overlay(theme.background)}>
							<Spinner color={theme.primary} size={32} />
						</View>
					) : null}
				</View>
			) : (
				<View style={styles_center}>
					<Spinner color={theme.primary} size={32} />
				</View>
			)}
		</View>
	);
}

function ErrorView({
	theme,
	title,
	detail,
	onBack,
	onRetry
}: {
	theme: ReturnType<typeof useTheme>;
	title: string;
	detail: string;
	onBack: () => void;
	onRetry?: () => void;
}) {
	return (
		<View style={{ flex: 1 }}>
			{/* Back stays the shared top-left round button, like every other screen. */}
			<View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
				<BackButton onPress={onBack} testID="instance-back-missing" />
			</View>
			<View
				style={{
					flex: 1,
					alignItems: "center",
					justifyContent: "center",
					paddingHorizontal: 32,
					paddingBottom: 64
				}}
			>
				<Text
					style={[
						heading("bold"),
						{ fontSize: 20, color: theme.foreground, textAlign: "center" }
					]}
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
				{onRetry ? (
					<PressableScale
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
						<RotateCw
							size={16}
							color={theme.primaryForeground}
							strokeWidth={2.4}
						/>
						<Text
							style={[
								body("semibold"),
								{ fontSize: 15, color: theme.primaryForeground }
							]}
						>
							Retry
						</Text>
					</PressableScale>
				) : null}
			</View>
		</View>
	);
}

const styles_center = {
	flex: 1,
	alignItems: "center",
	justifyContent: "center"
} as const;

const styles_overlay = (backgroundColor: string) =>
	({
		position: "absolute",
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor
	}) as const;
