// Which instance the user is currently viewing, shared between the thin
// /instance/[id] route (which only marks focus) and the InstanceHost mounted
// above the navigator (which owns the WebView). Keeping the WebView above the
// navigator is the whole point: a stack pop unmounts the screen, and with it the
// WebView's native process - so returning to an instance rebooted its workbench.
// The host stays mounted, so the last instance stays warm and returning is instant.
import { useSyncExternalStore } from "react";

// What the route needs from the live page to gate the iOS edge-swipe (the host
// owns the state; the route owns the navigation option). See back-decision.
export type HostBackState = { pageVisible: boolean; pageLayerOpen: boolean };

type HostState = {
	// The instance route currently focused, or null when the list (or any other
	// screen) is on top. The host keeps the last non-null one warm regardless.
	activeId: string | null;
	back: HostBackState;
};

let state: HostState = {
	activeId: null,
	back: { pageVisible: false, pageLayerOpen: false }
};
const listeners = new Set<() => void>();

function emit() {
	for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

// The route calls this on focus (id) and blur (null).
export function setActiveInstance(id: string | null) {
	if (state.activeId === id) return;
	state = { ...state, activeId: id };
	emit();
}

// Focus cleanup can arrive after the next route has focused. Only the route
// that claimed the active id may clear it, or an old cleanup can park the new
// instance host after navigation has already finished.
export function clearActiveInstance(id: string) {
	if (state.activeId === id) setActiveInstance(null);
}

export function getActiveInstanceId(): string | null {
	return state.activeId;
}

// The host publishes the live back state so the route can gate the swipe.
export function publishHostBackState(back: HostBackState) {
	if (
		state.back.pageVisible === back.pageVisible &&
		state.back.pageLayerOpen === back.pageLayerOpen
	) {
		return;
	}
	state = { ...state, back };
	emit();
}

export function useActiveInstanceId(): string | null {
	return useSyncExternalStore(
		subscribe,
		getActiveInstanceId,
		getActiveInstanceId
	);
}

export function useHostBackState(): HostBackState {
	return useSyncExternalStore(
		subscribe,
		() => state.back,
		() => state.back
	);
}
