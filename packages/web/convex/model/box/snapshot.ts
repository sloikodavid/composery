// What a box snapshot is, as words.
//
// Both planes read these: `convex/schema.ts` builds the stored columns from
// them, and the interface labels every one of them (`ui/box/status-text.tsx`
// keeps a `Record<SnapshotStatus, ...>`, so a status added here fails to compile
// until it has a word).
export const SNAPSHOT_CLASSES = ["manual", "scheduled"] as const;

export type SnapshotClass = (typeof SNAPSHOT_CLASSES)[number];

// `pending` is a row that exists before Hetzner has been asked; `creating` is
// one Hetzner is working on. They are kept apart because only the second has a
// provider image behind it, which is what the reclaim sweep looks for.
export const SNAPSHOT_STATUSES = [
	"pending",
	"creating",
	"complete",
	"failed",
	"deleting"
] as const;

export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];
