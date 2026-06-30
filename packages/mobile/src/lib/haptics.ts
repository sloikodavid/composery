// Haptics wrappers. expo-haptics throws on web, so calls no-op there.
// Fire-and-forget — callers never await.
import {
	impactAsync,
	ImpactFeedbackStyle,
	notificationAsync,
	NotificationFeedbackType,
	selectionAsync
} from "expo-haptics";
import { Platform } from "react-native";

const enabled = Platform.OS !== "web";

export function tapFeedback() {
	if (enabled) void impactAsync(ImpactFeedbackStyle.Light);
}

export function selectFeedback() {
	if (enabled) void selectionAsync();
}

export function successFeedback() {
	if (enabled) void notificationAsync(NotificationFeedbackType.Success);
}

export function errorFeedback() {
	if (enabled) void notificationAsync(NotificationFeedbackType.Error);
}
