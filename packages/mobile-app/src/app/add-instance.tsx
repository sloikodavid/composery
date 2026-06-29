import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { useEffect, useState } from "react";
import { Keyboard, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BackButton } from "@/components/back-button";
import { body, heading } from "@/lib/fonts";
import { errorFeedback, successFeedback, tapFeedback } from "@/lib/haptics";
import { createInstanceStore } from "@/lib/instance-store";
import { useTheme } from "@/lib/use-theme";

const store = createInstanceStore(AsyncStorage);

function firstParam(value: string | string[] | undefined) {
	return Array.isArray(value) ? value[0] : value;
}

type EditLoadState =
	| { id: string; type: "loaded" }
	| { id: string; type: "failed"; message: string };

export default function AddInstanceScreen() {
	const theme = useTheme();
	// `url` arrives from a scan (router.replace) or the composery://add-instance
	// deep link, prefilling a new instance; `id` means we're editing an existing one.
	const { id, url: urlParam } = useLocalSearchParams<{
		id?: string | string[];
		url?: string | string[];
	}>();
	const instanceId = firstParam(id);
	const scannedUrl = firstParam(urlParam);
	const editing = Boolean(instanceId);
	const [url, setUrl] = useState(scannedUrl ?? "");
	const [label, setLabel] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [editLoad, setEditLoad] = useState<EditLoadState | null>(null);
	const [submitting, setSubmitting] = useState(false);

	// Edit mode: prefill from the stored instance.
	useEffect(() => {
		if (!instanceId) return;
		let active = true;
		store
			.get(instanceId)
			.then((instance) => {
				if (!active) return;
				if (!instance) {
					setEditLoad({
						id: instanceId,
						type: "failed",
						message: "Instance not found."
					});
					return;
				}
				setUrl(instance.url);
				setLabel(instance.label);
				setError(null);
				setEditLoad({ id: instanceId, type: "loaded" });
			})
			.catch((err) => {
				if (!active) return;
				setEditLoad({
					id: instanceId,
					type: "failed",
					message:
						err instanceof Error ? err.message : "Could not load instance."
				});
			});
		return () => {
			active = false;
		};
	}, [instanceId]);

	const activeEditLoad =
		editing && editLoad?.id === instanceId ? editLoad : null;
	const loadErrorMessage =
		activeEditLoad?.type === "failed" ? activeEditLoad.message : null;
	const instanceLoaded = !editing || activeEditLoad?.type === "loaded";
	const loadingInstance = editing && !instanceLoaded && !loadErrorMessage;
	const displayError = loadingInstance ? null : (loadErrorMessage ?? error);
	const formEditable = instanceLoaded && !loadingInstance && !submitting;
	const displayedUrl = editing && !instanceLoaded ? "" : url;
	const displayedLabel = editing && !instanceLoaded ? "" : label;

	async function submit() {
		if (!instanceLoaded || loadingInstance || submitting) return;
		const trimmed = url.trim();
		if (!trimmed) {
			setError("Enter an instance URL.");
			return;
		}
		setError(null);
		setSubmitting(true);
		try {
			if (editing && instanceId) {
				await store.update(instanceId, { url: trimmed, label });
			} else {
				await store.create({ url: trimmed, label });
			}
			successFeedback();
			Keyboard.dismiss();
			router.dismiss();
		} catch (err) {
			errorFeedback();
			setError(err instanceof Error ? err.message : "Could not save instance.");
		} finally {
			setSubmitting(false);
		}
	}

	const canSubmit =
		url.trim().length > 0 && instanceLoaded && !loadingInstance && !submitting;
	const inputStyle = {
		...body(),
		backgroundColor: theme.muted,
		borderColor: theme.border,
		borderWidth: 1,
		borderRadius: 12,
		paddingHorizontal: 14,
		paddingVertical: 13,
		fontSize: 16,
		color: theme.foreground
	} as const;

	return (
		<SafeAreaView
			edges={["top", "bottom"]}
			style={{ flex: 1, backgroundColor: theme.background }}
		>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					paddingHorizontal: 16,
					paddingVertical: 12
				}}
			>
				<BackButton
					testID="add-instance-cancel"
					onPress={() => router.dismiss()}
					disabled={submitting}
				/>
				<Text
					style={[
						heading("semibold"),
						{ fontSize: 17, color: theme.foreground }
					]}
				>
					{editing ? "Edit instance" : "Add instance"}
				</Text>
				<Pressable
					testID="add-instance-submit"
					onPress={() => {
						tapFeedback();
						void submit();
					}}
					disabled={!canSubmit}
					hitSlop={12}
					style={({ pressed }) => ({
						opacity: !canSubmit || loadingInstance ? 0.35 : pressed ? 0.4 : 1
					})}
				>
					{/* Always primary tint; disabled reads as dimmed (iOS pattern). */}
					<Text
						style={[body("semibold"), { fontSize: 16, color: theme.primary }]}
					>
						{editing ? "Save" : "Add"}
					</Text>
				</Pressable>
			</View>

			<View style={{ padding: 16, gap: 8 }}>
				<Text
					style={[
						body("semibold"),
						{ fontSize: 14, color: theme.foreground, marginTop: 8 }
					]}
				>
					URL
				</Text>
				<TextInput
					testID="add-instance-url-input"
					value={displayedUrl}
					onChangeText={setUrl}
					placeholder="example.composery.cloud"
					placeholderTextColor={theme.mutedForeground}
					autoFocus={!editing}
					autoCapitalize="none"
					autoCorrect={false}
					spellCheck={false}
					keyboardType="url"
					textContentType="URL"
					enterKeyHint="next"
					editable={formEditable}
					style={inputStyle}
				/>

				<Text
					style={[
						body("semibold"),
						{ fontSize: 14, color: theme.foreground, marginTop: 8 }
					]}
				>
					Label{" "}
					<Text style={[body(), { color: theme.mutedForeground }]}>
						(optional)
					</Text>
				</Text>
				<TextInput
					testID="add-instance-label-input"
					value={displayedLabel}
					onChangeText={setLabel}
					placeholder="My Composery"
					placeholderTextColor={theme.mutedForeground}
					autoCapitalize="words"
					enterKeyHint="done"
					onSubmitEditing={() => void submit()}
					editable={formEditable}
					style={inputStyle}
				/>

				{displayError ? (
					<Text
						testID="add-instance-error"
						style={[
							body(),
							{ fontSize: 14, color: theme.destructive, marginTop: 8 }
						]}
					>
						{displayError}
					</Text>
				) : null}

				<Pressable
					onPress={() => {
						tapFeedback();
						void openBrowserAsync("https://www.composery.io/pricing");
					}}
					hitSlop={8}
					style={({ pressed }) => ({
						flexDirection: "row",
						alignItems: "center",
						marginTop: 10,
						opacity: pressed ? 0.5 : 1
					})}
				>
					<Text
						style={[body(), { fontSize: 13, color: theme.mutedForeground }]}
					>
						{"Want a Composery? "}
					</Text>
					<Text
						style={[body("semibold"), { fontSize: 13, color: theme.primary }]}
					>
						Get one →
					</Text>
				</Pressable>
			</View>
		</SafeAreaView>
	);
}
