export type BoxPasswordStrength = {
	ok: boolean;
	label: "Empty" | "Weak" | "Okay" | "Strong";
	message: string;
	score: number;
};

const COMMON_PASSWORD_PARTS = [
	"123456",
	"abcdef",
	"admin",
	"composery",
	"iloveyou",
	"letmein",
	"password",
	"qwerty",
	"welcome"
];

const PASSWORD_MINIMUM_LENGTH = 12;

export function checkBoxPasswordStrength(
	password: string
): BoxPasswordStrength {
	if (!password) {
		return {
			ok: false,
			label: "Empty",
			message: "Choose a password for this box.",
			score: 0
		};
	}

	const normalized = password.toLowerCase();
	const categories = [
		/[a-z]/.test(password),
		/[A-Z]/.test(password),
		/\d/.test(password),
		/[^A-Za-z0-9]/.test(password)
	].filter(Boolean).length;
	const uniqueCharacters = new Set(password).size;
	const hasCommonPart = COMMON_PASSWORD_PARTS.some((part) =>
		normalized.includes(part)
	);
	const hasLongRepeat = /(.)\1{3,}/.test(password);

	if (password.length < PASSWORD_MINIMUM_LENGTH) {
		return {
			ok: false,
			label: "Weak",
			message: "Use at least 12 characters.",
			score: 1
		};
	}

	if (hasCommonPart) {
		return {
			ok: false,
			label: "Weak",
			message: "Use a less common password.",
			score: 1
		};
	}

	if (hasLongRepeat || uniqueCharacters < 6) {
		return {
			ok: false,
			label: "Weak",
			message: "Avoid repeated characters.",
			score: 1
		};
	}

	const score = [
		password.length >= 14,
		password.length >= 18,
		password.length >= 24,
		categories >= 2,
		categories >= 3,
		uniqueCharacters >= Math.min(password.length, 10)
	].filter(Boolean).length;

	const ok =
		password.length >= 20 ||
		(password.length >= 14 && categories >= 2) ||
		(password.length >= PASSWORD_MINIMUM_LENGTH && categories >= 3);

	if (!ok) {
		return {
			ok: false,
			label: "Weak",
			message: "Use a longer passphrase or mix in another character type.",
			score
		};
	}

	return {
		ok: true,
		label: score >= 5 ? "Strong" : "Okay",
		message:
			score >= 5
				? "Looks strong. We will check breaches before continuing."
				: "Looks okay. A longer passphrase would be stronger.",
		score
	};
}

export async function checkPwnedBoxPassword(
	password: string,
	signal?: AbortSignal
) {
	const hash = await sha1Hex(password);
	const prefix = hash.slice(0, 5);
	const suffix = hash.slice(5);
	const response = await fetch(
		`https://api.pwnedpasswords.com/range/${prefix}`,
		{
			headers: {
				"Add-Padding": "true"
			},
			signal
		}
	);

	if (!response.ok) {
		throw new Error("Pwned Passwords check failed.");
	}

	const body = await response.text();
	for (const line of body.split("\n")) {
		const [candidate, count] = line.trim().split(":");
		if (candidate?.toUpperCase() === suffix) {
			return Number.parseInt(count ?? "0", 10) || 0;
		}
	}

	return 0;
}

async function sha1Hex(value: string) {
	const digest = await crypto.subtle.digest(
		"SHA-1",
		new TextEncoder().encode(value)
	);

	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("")
		.toUpperCase();
}
