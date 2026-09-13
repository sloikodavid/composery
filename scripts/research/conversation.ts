export type Conversation = {
	title: string;
	createdAt: Date;
	assistant: string;
	turns: { role: "user" | "assistant"; text: string }[];
};
