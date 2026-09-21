/** Quotes a value so a POSIX shell reads it as one word of data, never as syntax. */
export function quoteShell(value: string) {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
