import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
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
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView from "react-native-webview";

import { BackButton } from "@/components/back-button";
import { PressableScale } from "@/components/pressable-scale";
import { Spinner } from "@/components/spinner";
import { backAction } from "@/lib/back-decision";
import { body, heading } from "@/lib/fonts";
import { publishHostBackState } from "@/lib/instance-host";
import { createInstanceStore, type Instance } from "@/lib/instance-store";
import {
	fetchServerStamp,
	probeComposery,
	type ProbeResult
} from "@/lib/probe";
import { useTheme, type Theme } from "@/lib/use-theme";
import { classifyWebViewNavigation } from "@/lib/webview-navigation";
import { openExternalUrl } from "@/lib/open-url";
import {
	buildBeforeLoad,
	INSTALL_SCRIPT,
	NATIVE_BACK_SCRIPT
} from "@/web/back-button";

const store = createInstanceStore(AsyncStorage);
type FailedProbe = Extract<ProbeResult, { ok: false }>;

// Light vs dark status-bar icons for a given strip color (relative luminance).
// The page only ever reports an opaque rgb()/rgba() (usableBg in
// back-button.ts), so the three channels are the whole story.
function isLight(color: string): boolean {
	const rgb = color.match(/\d+(\.\d+)?/g);
	if (!rgb || rgb.length < 3) return true;
	const [r, g, b] = rgb.map(Number);
	return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

// The IDE for one instance. Rendered by InstanceHost above the navigator and kept
// mounted while it is the warm instance, so returning to it does not reboot the
// workbench. `active` is whether this is the instance the user is looking at right
// now (the rest of the time it stays alive but hidden and inert); `onLeave` pops
// back to the instances list. All the system-action wiring (hardware back, the
// keyboard inset, foreground checks) is gated on `active` so the hidden view never
// answers a back press or a keyboard meant for the screen actually on top.
export function InstanceView({
	instanceId,
	active,
	onLeave
}: {
	instanceId: string;
	active: boolean;
	onLeave: () => void;
}) {
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
	// The page's latest report of whether it has a layer open (menu, dialog,
	// full-screen part). A hint for the back press below, not the authority - the
	// page decides, and both stale directions correct themselves.
	const [pageLayerOpen, setPageLayerOpen] = useState(false);
	// Live title-bar background reported by the page, so the status-bar strip
	// matches whatever IDE theme the user runs.
	const [stripColor, setStripColor] = useState<string | null>(null);
	// Android only: the on-screen keyboard's height, kept out of the WebView's own
	// height (see the keyboard effect below). Always 0 on iOS.
	const [keyboardInset, setKeyboardInset] = useState(0);
	const webviewRef = useRef<WebView>(null);
	// Tracks whether the current webview load errored, so onLoadEnd can clear
	// loadError only on a successful reload — keeping the error overlay mounted
	// (and the Retry button busy) through the whole retry attempt, with no blink.
	const errorThisLoad = useRef(false);
	// Server build stamp captured after a successful load; compared on
	// app-foreground and on re-activation so a WebView that outlived a Composery
	// update reloads instead of running the old client against the new server.
	const serverStamp = useRef<string | null>(null);

	// Re-read the instance record after the user's own action (the storage-error
	// Retry). A fresh mount already shows the loading state, so only this explicit
	// path resets the view; the effects below load without resetting.
	function reloadRecord() {
		setLoading(true);
		setStorageError(null);
		setInstance(undefined);
		store
			.get(instanceId)
			.then((next) => {
				setInstance(next);
				setLoading(false);
			})
			.catch((err) => {
				setStorageError(
					err instanceof Error ? err.message : "Could not load instances."
				);
				setLoading(false);
			});
	}

	// First load. A fresh mount already shows the loading state (InstanceHost keys
	// this by instance, so a different instance is a fresh mount, not a prop change
	// into a live view), so this just fills it in - setState only in the callbacks.
	useEffect(() => {
		let alive = true;
		store
			.get(instanceId)
			.then((next) => {
				if (!alive) return;
				setInstance(next);
				setLoading(false);
			})
			.catch((err) => {
				if (!alive) return;
				setStorageError(
					err instanceof Error ? err.message : "Could not load instances."
				);
				setLoading(false);
			});
		return () => {
			alive = false;
		};
	}, [instanceId]);

	// Probe the instance before mounting the WebView. A non-Composery URL is
	// rejected with an error screen instead of a blank embed. Re-runs on retry
	// (reloadKey) and when switching to a different instance.
	useEffect(() => {
		const url = instance?.url;
		if (!url) return;
		let alive = true;
		const key = `${url}:${reloadKey}`;
		void probeComposery(url).then((result) => {
			if (!alive) return;
			setProbeResult({ key, result });
			if (!result.ok) setLastFailure({ url, result });
			if (result.ok) setWebLoading(true);
		});
		return () => {
			alive = false;
		};
	}, [instance?.url, reloadKey]);

	const resetTransientWebViewState = useCallback(() => {
		setPageLayerOpen(false);
		setWebLoading(true);
	}, []);

	const recoverWebViewProcess = useCallback(() => {
		setLoadError(null);
		errorThisLoad.current = false;
		resetTransientWebViewState();
		setReloadKey((k) => k + 1);
	}, [resetTransientWebViewState]);

	// Re-read the record and re-check the server stamp when this view becomes the
	// one on screen again. The record read picks up an edit made while away (setState
	// only in the callback, so an unchanged URL never resets the live view); the
	// stamp check catches a Composery that was updated while this warm WebView sat
	// in the background running the old client.
	useEffect(() => {
		if (!active) return;
		let alive = true;
		store
			.get(instanceId)
			.then((next) => {
				if (alive) setInstance(next);
			})
			.catch(() => undefined);
		webviewRef.current?.requestFocus();
		const url = instance?.url;
		const loadedStamp = serverStamp.current;
		if (url && loadedStamp) {
			void fetchServerStamp(url).then((stamp) => {
				if (stamp && stamp !== loadedStamp) {
					serverStamp.current = null;
					recoverWebViewProcess();
				}
			});
		}
		return () => {
			alive = false;
		};
		// instance?.url intentionally omitted: this fires on activation, not on
		// every record refresh, or the silent reload above would loop it.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [active]);

	// Android can foreground the app without the WebView re-gaining native focus;
	// grant it back so the IDE's own focus tracking (window-focus-resample.diff)
	// sees document focus return and the IME can open again. Also re-check the
	// server's build stamp: a backgrounded WebView can outlive a Composery
	// update, and its workbench would keep running the old client forever. Only
	// while this instance is the one on screen.
	useEffect(() => {
		if (!active) return;
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
	}, [active, instance?.url, recoverWebViewProcess]);

	// When the system scheme flips, tell the page so code-server re-detects its
	// theme without a reload. Fires whether or not this view is on screen, so a
	// warm instance is already correct when the user returns to it.
	useEffect(() => {
		webviewRef.current?.injectJavaScript(
			`window.__composerySetScheme && window.__composerySetScheme(${JSON.stringify(
				scheme === "dark" ? "dark" : "light"
			)}); true;`
		);
	}, [scheme]);

	// Android edge-to-edge activities are not resized for the IME: nothing consumes
	// the ime() window inset, so this WebView keeps its full height and runs on
	// underneath the keyboard. The page is then permanently taller than the part of
	// it anyone can see - the workbench fits itself to the visual viewport, and the
	// layout viewport keeps the difference as live but empty canvas that the visual
	// viewport pans into, which is the blank space you can scroll the workbench off
	// into. Consume the inset here instead, where it belongs: shrink the WebView by
	// the keyboard's height and layout, visual viewport and document agree again,
	// with nothing underneath to reveal.
	//
	// iOS needs the opposite treatment - WKWebView reports its own keyboard
	// geometry, and has had regressions doing it - so there the overlap is still
	// reported to the IDE and the view keeps its height.
	//
	// Only while on screen: a keyboard opening for the add-instance form must not
	// drive this hidden view's inset or inject into its background WebView.
	useEffect(() => {
		if (!active) return;
		if (Platform.OS === "android") {
			const subscriptions = [
				Keyboard.addListener("keyboardDidShow", (event: KeyboardEvent) =>
					// Measured from the keyboard's top edge to the bottom of the screen,
					// not endCoordinates.height: the reported height stops at the
					// navigation bar's inset while the keyboard window itself covers it,
					// and the difference is exactly as much page as this is meant to hide.
					setKeyboardInset(
						Math.max(
							0,
							Math.round(
								Dimensions.get("screen").height - event.endCoordinates.screenY
							)
						)
					)
				),
				Keyboard.addListener("keyboardDidHide", () => setKeyboardInset(0))
			];
			return () => {
				subscriptions.forEach((subscription) => subscription.remove());
				setKeyboardInset(0);
			};
		}

		const applyInset = (inset: number) => {
			webviewRef.current?.injectJavaScript(
				`document.documentElement.style.setProperty("--composery-touch-keyboard-inset", ${JSON.stringify(
					`${Math.max(0, Math.round(inset))}px`
				)}); window.dispatchEvent(new Event("composery-native-keyboard-change")); true;`
			);
		};
		const subscriptions = [
			Keyboard.addListener(
				"keyboardWillChangeFrame",
				(event: KeyboardEvent) => {
					const screenHeight = Dimensions.get("screen").height;
					const { height, screenY } = event.endCoordinates;
					const docked = screenY + height >= screenHeight - 2;
					applyInset(docked ? screenHeight - screenY : 0);
				}
			),
			Keyboard.addListener("keyboardDidHide", () => applyInset(0))
		];
		return () => subscriptions.forEach((subscription) => subscription.remove());
	}, [active]);

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
	// Whether the page - rather than a spinner, a veil or an error - is the thing
	// on screen. The strip and its icons are only the IDE's while that holds: a
	// colour kept from a page that has since errored or started reloading leaves
	// the last theme's bar sitting over this screen's own background.
	const pageVisible = probeOk && !loadError && !webLoading;
	const pageBg = pageVisible ? stripColor : null;
	const stripBg = pageBg ?? theme.background;
	const statusStyle = pageBg
		? isLight(pageBg)
			? "dark"
			: "light"
		: scheme === "dark"
			? "light"
			: "dark";
	// Identity only: this gesture claims nothing and changes no behaviour. Its job is
	// to make the WebView a participant in the gesture arbitration it already sits
	// inside, rather than an opaque native child - see the GestureDetector below.
	const webviewGesture = useMemo(() => Gesture.Native(), []);

	// Publish the back state so the route can gate the iOS edge-swipe. Only while
	// on screen; when hidden the route for another screen owns the swipe.
	useEffect(() => {
		if (active) publishHostBackState({ pageVisible, pageLayerOpen });
	}, [active, pageVisible, pageLayerOpen]);

	// Hardware Back / the back gesture: the page gets first refusal on every press,
	// and anything it does not claim leaves for the instance list. The WebView's own
	// history is never walked - it holds login redirects, not places to return to.
	// Only while on screen, so the warm hidden view never answers a back press meant
	// for the list underneath it.
	useEffect(() => {
		if (!active) return;
		const onBack = () => {
			const action = backAction({ pageVisible, pageLayerOpen });
			if (action.askPage) {
				webviewRef.current?.injectJavaScript(NATIVE_BACK_SCRIPT);
			}
			if (action.leave) {
				onLeave();
			}
			return true;
		};
		const subscription = BackHandler.addEventListener(
			"hardwareBackPress",
			onBack
		);
		return () => subscription.remove();
	}, [active, pageVisible, pageLayerOpen, onLeave]);

	return (
		<View style={{ flex: 1, backgroundColor: theme.background }}>
			{active ? <StatusBar style={statusStyle} /> : null}
			{/* Status-bar strip, tinted to the IDE title bar so the two read as one. */}
			<View style={{ height: insets.top, backgroundColor: stripBg }} />

			{loading ? (
				<ChromeLoading theme={theme} onBack={onLeave} />
			) : storageError ? (
				<ErrorView
					theme={theme}
					title="Couldn't load instances"
					detail={storageError}
					onBack={onLeave}
					onRetry={reloadRecord}
				/>
			) : !instance ? (
				<ErrorView
					theme={theme}
					title="Instance not found"
					detail="It may have been removed."
					onBack={onLeave}
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
						paddingBottom: Platform.OS === "ios" ? insets.bottom : keyboardInset
					}}
				>
					{/* The WebView handles its own touches, but it sits under the app's
					    GestureHandlerRootView, which arbitrates every touch in the tree. To an
					    arbiter that does not know this child, a gesture the OS claims midway -
					    the Android back swipe - ends without the ACTION_CANCEL that would
					    otherwise reach it, so the page is left holding a touchstart with no
					    touchend, touchmove or touchcancel to follow, and any in-page long-press
					    timer fires under the swiping finger. A native gesture enrols the WebView
					    in that arbitration as itself, which is what restores the cancel
					    (device-verified 2026-07-20: it lands 165ms into a back swipe, well
					    inside the 700ms the page waits before calling a touch a long press). */}
					<GestureDetector gesture={webviewGesture}>
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
								// "Leave for the instances list": the titlebar back button, and
								// the page's answer when a back press found nothing to close.
								if (data === "composery:back") onLeave();
								else if (data === "composery:overlay-back:on") {
									setPageLayerOpen(true);
								} else if (data === "composery:overlay-back:off") {
									setPageLayerOpen(false);
								} else if (data.startsWith("composery:bg:")) {
									// Empty means the page has no opaque surface to match; fall
									// back to this screen's own background.
									setStripColor(data.slice("composery:bg:".length) || null);
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
								setPageLayerOpen(false);
								// The next page reports its own; until it does, this screen's
								// background is the honest answer rather than the last page's.
								setStripColor(null);
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
							onShouldStartLoadWithRequest={(request) => {
								const target = classifyWebViewNavigation({
									instanceUrl: instance.url,
									isTopFrame: request.isTopFrame,
									requestUrl: request.url
								});
								if (target === "inside") return true;
								if (target === "external") {
									void openExternalUrl(request.url);
								}
								return false;
							}}
							testID="instance-webview"
						/>
					</GestureDetector>

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
								onBack={onLeave}
								onRetry={retry}
								retrying={webRetrying}
								onOpenInBrowser={() => void openExternalUrl(instance.url)}
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
							<ChromeLoading theme={theme} onBack={onLeave} />
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
					onBack={onLeave}
					onRetry={retry}
					retrying={probing}
					onOpenInBrowser={() => void openExternalUrl(instance.url)}
				/>
			) : (
				<ChromeLoading theme={theme} onBack={onLeave} />
			)}
		</View>
	);
}

// Top-left round back button in a fixed pad so it sits in the same spot across
// every non-WebView state (loading, probing, error) — it never vanishes while
// content is still loading.
function ScreenHeader({
	onBack,
	testID
}: {
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
			<ScreenHeader onBack={onBack} />
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
			<ScreenHeader onBack={onBack} testID={backTestID} />
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
