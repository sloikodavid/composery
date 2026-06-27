import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useState } from "react";
import {
	Keyboard,
	Pressable,
	StyleSheet,
	Text,
	TextInput,
	View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createId } from "@/lib/id";
import { add, createInstanceStore } from "@/lib/instance-store";
import { useTheme } from "@/lib/use-theme";

const store = createInstanceStore(AsyncStorage);

// The palette has no destructive token (the docs-website oklch palette defines
// none); a single muted red reads on both light and dark backgrounds.
const errorColor = "#b91c1c";

export default function AddInstanceScreen() {
	const theme = useTheme();
	const [url, setUrl] = useState("");
	const [label, setLabel] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);

	async function submit() {
		const trimmed = url.trim();
		if (!trimmed) {
			setError("Enter an instance URL.");
			return;
		}
		setError(null);
		setSubmitting(true);
		try {
			// add() is synchronous and throws on an invalid URL or a duplicate.
			const list = await store.loadAll();
			const instance = add(list, { url: trimmed, label }, createId);
			await store.persist([instance, ...list]);
			Keyboard.dismiss();
			router.dismiss();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not add instance.");
		} finally {
			setSubmitting(false);
		}
	}

	function cancel() {
		router.dismiss();
	}

	const canSubmit = url.trim().length > 0 && !submitting;

	return (
		<SafeAreaView
			edges={["top", "bottom"]}
			style={[styles.container, { backgroundColor: theme.background }]}
		>
			<View style={[styles.header, { borderBottomColor: theme.border }]}>
				<Pressable
					testID="add-instance-cancel"
					onPress={cancel}
					hitSlop={12}
					disabled={submitting}
				>
					<Text style={[styles.cancel, { color: theme.primary }]}>Cancel</Text>
				</Pressable>
				<Text style={[styles.title, { color: theme.foreground }]}>
					Add instance
				</Text>
				<Pressable
					testID="add-instance-submit"
					onPress={submit}
					disabled={!canSubmit}
					hitSlop={12}
				>
					<Text
						style={[
							styles.save,
							{ color: canSubmit ? theme.primary : theme.mutedForeground }
						]}
					>
						Add
					</Text>
				</Pressable>
			</View>

			<View style={styles.body}>
				<Text style={[styles.label, { color: theme.foreground }]}>URL</Text>
				<TextInput
					testID="add-instance-url-input"
					value={url}
					onChangeText={setUrl}
					placeholder="https://mybox.com"
					placeholderTextColor={theme.mutedForeground}
					autoFocus
					autoCapitalize="none"
					autoCorrect={false}
					spellCheck={false}
					keyboardType="url"
					textContentType="URL"
					enterKeyHint="next"
					style={[
						styles.input,
						{
							backgroundColor: theme.muted,
							borderColor: theme.border,
							color: theme.foreground
						}
					]}
				/>

				<Text style={[styles.label, { color: theme.foreground }]}>
					Label <Text style={{ color: theme.mutedForeground }}>(optional)</Text>
				</Text>
				<TextInput
					testID="add-instance-label-input"
					value={label}
					onChangeText={setLabel}
					placeholder="My Composery"
					placeholderTextColor={theme.mutedForeground}
					autoCapitalize="words"
					enterKeyHint="done"
					style={[
						styles.input,
						{
							backgroundColor: theme.muted,
							borderColor: theme.border,
							color: theme.foreground
						}
					]}
				/>

				{error && (
					<Text testID="add-instance-error" style={styles.error}>
						{error}
					</Text>
				)}

				<Text style={[styles.hint, { color: theme.mutedForeground }]}>
					Self-hosted or Composery Cloud. The URL opens in a WebView — you sign
					in there, the app never sees your password.
				</Text>
			</View>
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
	cancel: {
		fontSize: 16
	},
	title: {
		fontSize: 16,
		fontWeight: "700"
	},
	save: {
		fontSize: 16,
		fontWeight: "700"
	},
	body: {
		padding: 16,
		gap: 8
	},
	label: {
		fontSize: 14,
		fontWeight: "600",
		marginTop: 8
	},
	input: {
		borderWidth: 1,
		borderRadius: 10,
		paddingHorizontal: 12,
		paddingVertical: 12,
		fontSize: 16
	},
	error: {
		color: errorColor,
		fontSize: 14,
		marginTop: 8
	},
	hint: {
		fontSize: 13,
		lineHeight: 18,
		marginTop: 12
	}
});
