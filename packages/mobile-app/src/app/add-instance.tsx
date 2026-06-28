import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { useEffect, useState } from "react";
import { Keyboard, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createId } from "@/lib/id";
import { body, heading } from "@/lib/fonts";
import { errorFeedback, successFeedback, tapFeedback } from "@/lib/haptics";
import { add, createInstanceStore, get, update } from "@/lib/instance-store";
import { useTheme } from "@/lib/use-theme";

const store = createInstanceStore(AsyncStorage);

export default function AddInstanceScreen() {
	const theme = useTheme();
	const { id } = useLocalSearchParams<{ id?: string }>();
	const editing = Boolean(id);
	const [url, setUrl] = useState("");
	const [label, setLabel] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	// Edit mode: prefill from the stored instance.
	useEffect(() => {
		if (!id) return;
		let active = true;
		store.loadAll().then((list) => {
			const instance = get(list, id);
			if (active && instance) {
				setUrl(instance.url);
				setLabel(instance.label);
			}
		});
		return () => {
			active = false;
		};
	}, [id]);

	async function submit() {
		const trimmed = url.trim();
		if (!trimmed) {
			setError("Enter an instance URL.");
			return;
		}
		setError(null);
		setSubmitting(true);
		try {
			// add()/update() are synchronous and throw on an invalid URL or duplicate.
			const list = await store.loadAll();
			if (editing && id) {
				await store.persist(update(list, id, { url: trimmed, label }));
			} else {
				const instance = add(list, { url: trimmed, label }, createId);
				await store.persist([instance, ...list]);
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

	const canSubmit = url.trim().length > 0 && !submitting;
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
				<Pressable
					testID="add-instance-cancel"
					onPress={() => {
						tapFeedback();
						router.dismiss();
					}}
					hitSlop={12}
					disabled={submitting}
					style={({ pressed }) => ({
						opacity: submitting ? 0.35 : pressed ? 0.4 : 1
					})}
				>
					<Text
						style={[body("medium"), { fontSize: 16, color: theme.primary }]}
					>
						Cancel
					</Text>
				</Pressable>
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
						opacity: !canSubmit ? 0.35 : pressed ? 0.4 : 1
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
					value={url}
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
					value={label}
					onChangeText={setLabel}
					placeholder="My Composery"
					placeholderTextColor={theme.mutedForeground}
					autoCapitalize="words"
					enterKeyHint="done"
					onSubmitEditing={() => void submit()}
					style={inputStyle}
				/>

				{error ? (
					<Text
						testID="add-instance-error"
						style={[
							body(),
							{ fontSize: 14, color: theme.destructive, marginTop: 8 }
						]}
					>
						{error}
					</Text>
				) : null}

				<Text
					style={[
						body(),
						{
							fontSize: 13,
							lineHeight: 19,
							color: theme.mutedForeground,
							marginTop: 12
						}
					]}
				>
					Self-hosted or Composery Cloud — you sign in on your instance.
				</Text>
				<Pressable
					onPress={() => {
						tapFeedback();
						void openBrowserAsync("https://composery.io/pricing");
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
						{"Don't have one? "}
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
