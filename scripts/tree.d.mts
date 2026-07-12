export type ReadDirectory = (path: string) => string[];

export function canonicalPath(
	root: string,
	path: string,
	readDirectory?: ReadDirectory
): string | undefined;

export function canonicalPaths(
	root: string,
	paths: string[],
	readDirectory?: ReadDirectory
): string[];
