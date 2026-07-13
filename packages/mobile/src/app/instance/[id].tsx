import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { openBrowserAsync } from "expo-web-browser";
import { ExternalLink, RotateCw } from "lucide-react-native";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState
} from "react";
import {
	AppState,
	BackHandler,
	Dimensions,
	Keyboard,
	type KeyboardEvent,
	Platform,
	Text,
	useColorScheme,
	View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView, { type WebViewNavigation } from "react-native-webview";

import { BackButton } from "@/components/back-button";
import { PressableScale } from "@/components/pressable-scale";
import { Spinner } from "@/components/spinner";
import { body, heading } from "@/lib/fonts";
import { createInstanceStore, type Instance } from "@/lib/instance-store";
import {
	fetchServerStamp,
	probeComposery,
	type ProbeResult
} from "@/lib/probe";
import { useTheme, type Theme } from "@/lib/use-theme";
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
	// probeResult holds the latest probe outcome keyed by `${url}:${reloadKey}`.
	// While the key doesn't match the current url+reloadKey, the probe is in-flight
	// (probing). lastFailure retains the previous failure for the same URL so a
	// retry keeps the error on screen with a busy button instead of flickering to
	// a blank spinner — only the initial probe (no prior failure) shows a spinner.
	const [probeResult, setProbeResult] = useState<{
		key: string;
		result: ProbeResult;
	} | null>(null);
	const [lastFailure, setLastFailure] = useState<{
		url: string;
		result: FailedProbe;
	} | null>(null);
	const [webLoading, setWebLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const [canGoBack, setCanGoBack] = useState(false);
	const [overlayBackActive, setOverlayBackActive] = useState(false);
	// Live title-bar background reported by the page, so the status-bar strip
	// matches whatever IDE theme the user runs.
	const [stripColor, setStripColor] = useState<string | null>(null);
	const webviewRef = useRef<WebView>(null);
	// Tracks whether the current webview load errored, so onLoadEnd can clear
	// loadError only on a successful reload — keeping the error overlay mounted
	// (and the Retry button busy) through the whole retry attempt, with no blink.
	const errorThisLoad = useRef(false);
	// Server build stamp captured after a successful load; compared on
	// app-foreground so a WebView that outlived a Composery update reloads
	// instead of running the old client against the new server.
	const serverStamp = useRef<string | null>(null);

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
			if (!result.ok) setLastFailure({ url, result });
			if (result.ok) setWebLoading(true);
		});
		return () => {
			active = false;
		};
	}, [instance?.url, reloadKey]);

	const webviewCanGoBack = canGoBack || overlayBackActive;

	useEffect(() => {
		const onBack = () => {
			if (webviewCanGoBack && webviewRef.current) {
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
	}, [webviewCanGoBack]);

	const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
		setCanGoBack(nav.canGoBack);
	}, []);

	const resetTransientWebViewState = useCallback(() => {
		setCanGoBack(false);
		setOverlayBackActive(false);
		setWebLoading(true);
	}, []);

	const recoverWebViewProcess = useCallback(() => {
		setLoadError(null);
		setStripColor(null);
		errorThisLoad.current = false;
		resetTransientWebViewState();
		setReloadKey((k) => k + 1);
	}, [resetTransientWebViewState]);

	// Android can foreground the app without the WebView re-gaining native focus;
	// grant it back so the IDE's own focus tracking (window-focus-resample.diff)
	// sees document focus return and the IME can open again. Also re-check the
	// server's build stamp: a backgrounded WebView can outlive a Composery
	// update, and its workbench would keep running the old client forever.
	useEffect(() => {
		const url = instance?.url;
		const subscription = AppState.addEventListener("change", (state) => {
			if (state !== "active") return;
			webviewRef.current?.requestFocus();
			const loadedStamp = serverStamp.current;
			if (!url || !loadedStamp) return;
			void fetchServerStamp(url).then((stamp) => {
				if (stamp && stamp !== loadedStamp) {
					serverStamp.current = null;
					recoverWebViewProcess();
				}
			});
		});
		return () => subscription.remove();
	}, [instance?.url, recoverWebViewProcess]);

	// When the system scheme flips while open, tell the page so code-server
	// re-detects its theme without a reload.
	useEffect(() => {
		webviewRef.current?.injectJavaScript(
			`window.__composerySetScheme && window.__composerySetScheme(${JSON.stringify(
				scheme === "dark" ? "dark" : "light"
			)}); true;`
		);
	}, [scheme]);

	// Android WebView in edge-to-edge Expo activities can leave innerHeight and
	// visualViewport unchanged while the IME overlays the lower half of the page.
	// WKWebView has also had keyboard/visual-viewport regressions on iOS 26. Send
	// the native, docked keyboard overlap to the IDE so its own layout can keep the
	// terminal keybar and bottom panels above the keyboard on both platforms.
	useEffect(() => {
		const applyInset = (inset: number) => {
			webviewRef.current?.injectJavaScript(
				`document.documentElement.style.setProperty("--composery-touch-keyboard-inset", ${JSON.stringify(
					`${Math.max(0, Math.round(inset))}px`
				)}); window.dispatchEvent(new Event("composery-native-keyboard-change")); true;`
			);
		};
		const onFrame = (event: KeyboardEvent) => {
			if (Platform.OS === "android") {
				applyInset(event.endCoordinates.height);
				return;
			}
			const screenHeight = Dimensions.get("screen").height;
			const { height, screenY } = event.endCoordinates;
			const docked = screenY + height >= screenHeight - 2;
			applyInset(docked ? screenHeight - screenY : 0);
		};
		const subscriptions = [
			Keyboard.addListener(
				Platform.OS === "ios" ? "keyboardWillChangeFrame" : "keyboardDidShow",
				onFrame
			),
			Keyboard.addListener("keyboardDidHide", () => applyInset(0))
		];
		return () => subscriptions.forEach((subscription) => subscription.remove());
	}, []);

	// One retry path for both probe failures and webview load errors: bump
	// reloadKey (re-probes and remounts the WebView). loadError is intentionally
	// NOT cleared here — it's cleared on a successful reload (onLoadEnd), so the
	// error overlay and its busy Retry button stay put through the attempt.
	function retry() {
		resetTransientWebViewState();
		setReloadKey((k) => k + 1);
	}

	const beforeLoad = useMemo(
		() => buildBeforeLoad(scheme === "dark" ? "dark" : "light", __DEV__),
		[scheme]
	);
	const instanceOrigin = instance ? new URL(instance.url).origin : "";
	const probeKey = instance ? `${instance.url}:${reloadKey}` : "";
	const probing = probeResult?.key !== probeKey;
	const probeCurrent =
		probeResult?.key === probeKey ? probeResult.result : null;
	const failedProbe: FailedProbe | null =
		probeCurrent && !probeCurrent.ok ? probeCurrent : null;
	const probeOk = probeCurrent?.ok === true;
	// While a retry probes the same URL, keep the last failure on screen instead
	// of swapping to a blank spinner.
	const shownFailure: FailedProbe | null =
		failedProbe ??
		(probing && lastFailure !== null && lastFailure.url === instance?.url
			? lastFailure.result
			: null);
	const webRetrying = loadError !== null && webLoading;
	const stripBg = stripColor ?? theme.background;
	const statusStyle = stripColor
		? isLight(stripColor)
			? "dark"
			: "light"
		: scheme === "dark"
			? "light"
			: "dark";
	const goBack = () => router.back();

	return (
		<View style={{ flex: 1, backgroundColor: theme.background }}>
			<StatusBar style={statusStyle} />
			{/* Status-bar strip, tinted to the IDE title bar so the two read as one. */}
			<View style={{ height: insets.top, backgroundColor: stripBg }} />

			{loading ? (
				<ChromeLoading theme={theme} onBack={goBack} />
			) : storageError ? (
				<ErrorView
					theme={theme}
					title="Couldn't load instances"
					detail={storageError}
					onBack={goBack}
					onRetry={() => loadInstance()}
				/>
			) : !instance ? (
				<ErrorView
					theme={theme}
					title="Instance not found"
					detail="It may have been removed."
					onBack={goBack}
					backTestID="instance-back-missing"
				/>
			) : probeOk ? (
				<View
					style={{
						flex: 1,
						// iOS 26 WKWebView can report stale or missing safe-area geometry,
						// especially after rotation. Keep the native view itself clear of
						// the home indicator and landscape sensor housing; the dedicated
						// status-bar strip above already owns the top inset.
						paddingLeft: Platform.OS === "ios" ? insets.left : 0,
						paddingRight: Platform.OS === "ios" ? insets.right : 0,
						paddingBottom: Platform.OS === "ios" ? insets.bottom : 0
					}}
				>
					<WebView
						key={reloadKey}
						ref={webviewRef}
						source={{ uri: instance.url }}
						// White (the browser's default canvas) so a transparent-body page —
						// e.g. an upstream Cloudflare/origin error page — renders as it
						// would in a desktop browser, not with the theme bleeding through.
						// The load flash is hidden by the overlay below, not this colour.
						style={{ flex: 1, backgroundColor: "#ffffff" }}
						automaticallyAdjustContentInsets={false}
						automaticallyAdjustsScrollIndicatorInsets={false}
						contentInsetAdjustmentBehavior="never"
						bounces={false}
						overScrollMode="never"
						keyboardDisplayRequiresUserAction={false}
						hideKeyboardAccessoryView
						allowsBackForwardNavigationGestures={false}
						allowsLinkPreview={false}
						// Array, not the string "none": under the New Architecture the
						// Fabric props parser casts dataDetectorTypes to a vector and a
						// bare string fails an isObject() assertion → native SIGABRT the
						// instant the WebView mounts (crashes the whole app on Android).
						dataDetectorTypes={["none"]}
						contentMode="mobile"
						setSupportMultipleWindows={false}
						// iOS uses WKHTTPCookieStore, Android CookieManager.
						sharedCookiesEnabled
						thirdPartyCookiesEnabled
						javaScriptEnabled
						domStorageEnabled
						webviewDebuggingEnabled={__DEV__}
						injectedJavaScriptBeforeContentLoaded={beforeLoad}
						injectedJavaScript={INSTALL_SCRIPT}
						onMessage={(event) => {
							const data = event.nativeEvent.data;
							// The titlebar back button is always "go home" — it pops straight
							// to the instances list, never walking the webview's own history
							// (that's the hardware/gesture back's job).
							if (data === "composery:back") goBack();
							else if (data === "composery:overlay-back:on") {
								setOverlayBackActive(true);
							} else if (data === "composery:overlay-back:off") {
								setOverlayBackActive(false);
							} else if (data.startsWith("composery:bg:")) {
								setStripColor(data.slice("composery:bg:".length));
							} else if (data.startsWith("composery:diag:")) {
								// WebView layout facts (see back-button.ts diag; dev-only sender) -
								// the WebView can't be inspected like a browser tab, so Metro logs them.
								console.log(
									"[instance-webview]",
									data.slice("composery:diag:".length)
								);
							}
						}}
						onLoadStart={() => {
							setOverlayBackActive(false);
							errorThisLoad.current = false;
							setWebLoading(true);
						}}
						onLoadEnd={() => {
							webviewRef.current?.requestFocus();
							setWebLoading(false);
							if (!errorThisLoad.current) {
								setLoadError(null);
								void fetchServerStamp(instance.url).then((stamp) => {
									serverStamp.current = stamp;
								});
							}
						}}
						onError={(event) => {
							errorThisLoad.current = true;
							setLoadError(event.nativeEvent.description || "");
						}}
						onContentProcessDidTerminate={recoverWebViewProcess}
						onRenderProcessGone={recoverWebViewProcess}
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

					{/* Webview load error: keep the error overlay mounted over the
						reloading WebView so Retry stays put and the back button never
						vanishes mid-attempt. Opaque, so it doubles as the load veil. */}
					{loadError ? (
						<View style={styles_overlay(theme.background)}>
							<ErrorView
								theme={theme}
								title="Couldn't load this instance"
								detail={
									<InlineUrl
										theme={theme}
										url={instance.url}
										rest=" failed to load."
									/>
								}
								note={loadError || undefined}
								onBack={goBack}
								onRetry={retry}
								retrying={webRetrying}
								onOpenInBrowser={() => void openBrowserAsync(instance.url)}
							/>
						</View>
					) : webLoading ? (
						// Loading veil over the booting WebView. Carries the same back
						// button as every other state so you can leave mid-load instead of
						// being stuck on a spinner. (The white-on-first-paint blink is
						// fixed at the source in the IDE, not hidden here.)
						<View
							style={[
								styles_overlay(theme.background),
								{ alignItems: "stretch", justifyContent: "flex-start" }
							]}
						>
							<ChromeLoading theme={theme} onBack={goBack} />
						</View>
					) : null}
				</View>
			) : shownFailure ? (
				<ErrorView
					theme={theme}
					title={
						shownFailure.reason === "not-composery"
							? "This isn't a Composery"
							: "Couldn't reach this instance"
					}
					detail={
						shownFailure.reason === "not-composery" ? (
							<InlineUrl
								theme={theme}
								url={instance.url}
								rest=" doesn't point to a Composery instance."
							/>
						) : (
							<InlineUrl
								theme={theme}
								url={instance.url}
								rest=" isn't responding."
							/>
						)
					}
					onBack={goBack}
					onRetry={retry}
					retrying={probing}
					onOpenInBrowser={() => void openBrowserAsync(instance.url)}
				/>
			) : (
				<ChromeLoading theme={theme} onBack={goBack} />
			)}
		</View>
	);
}

// Top-left round back button in a fixed pad so it sits in the same spot across
// every non-WebView state (loading, probing, error) — it never vanishes while
// content is still loading.
function ScreenHeader({
	theme,
	onBack,
	testID
}: {
	theme: Theme;
	onBack: () => void;
	testID?: string;
}) {
	return (
		<View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
			<BackButton onPress={onBack} testID={testID} />
		</View>
	);
}

function ChromeLoading({
	theme,
	onBack
}: {
	theme: Theme;
	onBack: () => void;
}) {
	return (
		<View style={{ flex: 1 }}>
			<ScreenHeader theme={theme} onBack={onBack} />
			<View style={styles_center}>
				<Spinner color={theme.primary} size={32} />
			</View>
		</View>
	);
}

// Inlines the URL in semibold foreground as the subject of an error sentence,
// with `rest` trailing in the parent's mutedForeground — used as ErrorView's
// selectable `detail` so the URL reads with hierarchy without a boxed chip.
function InlineUrl({
	theme,
	url,
	rest
}: {
	theme: Theme;
	url: string;
	rest: string;
}) {
	return (
		<>
			<Text style={[body("semibold"), { color: theme.foreground }]}>{url}</Text>
			<Text>{rest}</Text>
		</>
	);
}

// The shared error layout: a bold title, then one selectable message line that
// inlines the URL in bold (foreground) so it reads as the subject of the
// sentence instead of a washed-out or boxed link. `note` is an optional
// smaller line for technical detail (e.g. the webview load error). Open in
// browser sits beside Retry for the URL-bearing failures; `retrying` swaps the
// Retry icon for a spinner and locks the press so the attempt can't be
// double-fired.
function ErrorView({
	theme,
	title,
	detail,
	note,
	onBack,
	onRetry,
	retrying,
	onOpenInBrowser,
	backTestID
}: {
	theme: Theme;
	title: string;
	detail: ReactNode;
	note?: string;
	onBack: () => void;
	onRetry?: () => void;
	retrying?: boolean;
	onOpenInBrowser?: () => void;
	backTestID?: string;
}) {
	const busy = Boolean(retrying);
	return (
		<View style={{ flex: 1 }}>
			<ScreenHeader theme={theme} onBack={onBack} testID={backTestID} />
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
					selectable
					style={[
						body(),
						{
							fontSize: 15,
							lineHeight: 21,
							textAlign: "center",
							color: theme.mutedForeground,
							marginTop: 8
						}
					]}
				>
					{detail}
				</Text>
				{note ? (
					<Text
						selectable
						numberOfLines={3}
						style={[
							body(),
							{
								fontSize: 13,
								lineHeight: 18,
								textAlign: "center",
								color: theme.mutedForeground,
								marginTop: 6
							}
						]}
					>
						{note}
					</Text>
				) : null}
				{onRetry || onOpenInBrowser ? (
					<View
						style={{
							flexDirection: "row",
							flexWrap: "wrap",
							alignItems: "center",
							justifyContent: "center",
							gap: 8,
							marginTop: 24
						}}
					>
						{onRetry ? (
							<PressableScale
								accessibilityRole="button"
								accessibilityLabel="Retry"
								disabled={busy}
								onPress={onRetry}
								style={{
									flexDirection: "row",
									alignItems: "center",
									gap: 8,
									paddingHorizontal: 18,
									paddingVertical: 12,
									borderRadius: 12,
									backgroundColor: theme.primary,
									opacity: busy ? 0.7 : 1
								}}
							>
								{busy ? (
									<Spinner color={theme.primaryForeground} size={16} />
								) : (
									<RotateCw
										size={16}
										color={theme.primaryForeground}
										strokeWidth={2.4}
									/>
								)}
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
						{onOpenInBrowser ? (
							<PressableScale
								accessibilityRole="button"
								accessibilityLabel="Open in browser"
								onPress={onOpenInBrowser}
								style={{
									flexDirection: "row",
									alignItems: "center",
									gap: 8,
									paddingHorizontal: 18,
									paddingVertical: 12,
									borderRadius: 12,
									backgroundColor: theme.background,
									borderWidth: 1,
									borderColor: theme.border
								}}
							>
								<ExternalLink
									size={16}
									color={theme.foreground}
									strokeWidth={2.4}
								/>
								<Text
									style={[
										body("semibold"),
										{ fontSize: 15, color: theme.foreground }
									]}
								>
									Open in browser
								</Text>
							</PressableScale>
						) : null}
					</View>
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
