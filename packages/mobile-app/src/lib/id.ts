/**
 * Tiny dependency-free id generator for a local instance list.
 *
 * Hermes has no `crypto.randomUUID` (and no `DOMException`) — see PLAN.md
 * Wrinkle 4. This is not a security id; it only needs to be unique enough to
 * key a list of locally-added instances.
 */
export function createId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
