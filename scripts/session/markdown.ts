export type SessionItem =
	| {
			kind: "turn";
			author: "user" | "assistant";
			text: string;
			timestamp?: Date;
	  }
	| { kind: "event"; text: string; timestamp?: Date };

export type Session = {
	title: string;
	createdAt: Date;
	assistant: string;
	sources: string[];
	items: SessionItem[];
};

const secretAssignment =
	/^(\s*[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY)[A-Z0-9_]*\s*[=:]\s*)(.+)$/gm;

function redactSessionSecrets(text: string): string {
	return text.replace(secretAssignment, "$1[redacted]");
}

export function renderSessionSource(sources: string[]): string {
	return `Source: ${sources.join(" → ")}`;
}

function renderSessionItem(
	session: Session,
	item: SessionItem,
	turnNumber: string,
): string {
	const timestamp = item.timestamp
		? `\n\n_${item.timestamp.toISOString()}_`
		: "";
	switch (item.kind) {
		case "turn": {
			const author = item.author === "user" ? "User" : session.assistant;
			return `---\n\n## Turn ${turnNumber}: ${author}${timestamp}\n\n${redactSessionSecrets(item.text)}`;
		}
		case "event":
			return `---\n\n> ${item.text}${timestamp}`;
	}
}

export function renderSessionMarkdown(session: Session): string {
	const turnCount = session.items.filter((item) => item.kind === "turn").length;
	const width = String(turnCount).length;
	let turn = 0;
	const items = session.items.map((item) => {
		if (item.kind === "turn") {
			turn += 1;
		}
		return renderSessionItem(session, item, String(turn).padStart(width, "0"));
	});
	return [
		`# ${session.title}`,
		"",
		renderSessionSource(session.sources),
		"",
		...items.flatMap((item) => [item, ""]),
	].join("\n");
}
