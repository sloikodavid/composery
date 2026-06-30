// Hermes has no crypto.randomUUID (PLAN.md Wrinkle 4). Not a security id — only
// unique enough to key a local instance list.
export function createId(): string {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
