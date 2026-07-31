export const GIT_FILE_ARGS: string[];

export function gitFiles(): string[];

export type Entry = { name: string; type: "directory" | "file" };

export function compareEntries(left: Entry, right: Entry): number;

export function dropStrayTrees(current: string): string;

export function renderTree(): string;

export function renderAgentsFile(current: string, tree: string): string;
