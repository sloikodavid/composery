export type CronRow = { job: string; schedule: string };

export function readCronRows(): CronRow[];

export function renderTable(rows: CronRow[]): string;

export function renderDoc(current: string, table: string): string;
