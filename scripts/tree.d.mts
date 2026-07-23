export const GIT_FILE_ARGS: string[];

export function gitFiles(): string[];

export type Entry = { name: string; type: "directory" | "file" };

export function compareEntries(left: Entry, right: Entry): number;
