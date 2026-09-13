export const sampleParagraph =
	"Composery gives you a server that your AI assistant can use. Build apps, store files, and run automations from Claude, ChatGPT, or Codex. When you need more control, open the advanced settings and connect with SSH.";

export const shortParagraph =
	"Your server keeps running when you close the chat. Apps, files, and automations stay where you put them.";

export const characterRows = [
	"ABCDEFGHIJKLMNOPQRSTUVWXYZ",
	"abcdefghijklmnopqrstuvwxyz",
	"0123456789",
	"& @ # % $ € £ ( ) [ ] { } / \\ | * + − × = < > ? ! . , : ; ' \" ‘ ’ “ ” - – — … · • → ←",
] as const;

export const legibilityRows = [
	"Il1| O0o rn m cl d 5S 8B 6b 9g",
	"Illinois 1 Il1 · O0 Oo · rnodern modern",
] as const;

export const kerningRows = [
	"AVAWAY Type Tokyo Yacht LT L’Y",
	"7.4 F. P. W. “Try” (joy) [fly]",
] as const;

export const numberRows = [
	["studio", "1,111.11"],
	["client-acme", "8,888.88"],
	["archive", "40.07"],
] as const;
