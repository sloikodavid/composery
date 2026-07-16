(() => {
	const commonParts = [
		"123456",
		"abcdef",
		"admin",
		"composery",
		"iloveyou",
		"letmein",
		"password",
		"qwerty",
		"welcome"
	]

	function checkStrength(password) {
		if (!password) {
			return {
				ok: false,
				message: "Choose a password for this box."
			}
		}

		const normalized = password.toLowerCase()
		const categories = [
			/[a-z]/.test(password),
			/[A-Z]/.test(password),
			/\d/.test(password),
			/[^A-Za-z0-9]/.test(password)
		].filter(Boolean).length
		const uniqueCharacters = new Set(password).size
		const hasCommonPart = commonParts.some((part) => normalized.includes(part))
		const hasLongRepeat = /(.)\1{3,}/.test(password)

		if (password.length < 12) {
			return { ok: false, message: "Use at least 12 characters." }
		}
		if (hasCommonPart) {
			return { ok: false, message: "Use a less common password." }
		}
		if (hasLongRepeat || uniqueCharacters < 6) {
			return { ok: false, message: "Avoid repeated characters." }
		}

		const score = [
			password.length >= 14,
			password.length >= 18,
			password.length >= 24,
			categories >= 2,
			categories >= 3,
			uniqueCharacters >= Math.min(password.length, 10)
		].filter(Boolean).length
		const ok =
			password.length >= 20 ||
			(password.length >= 14 && categories >= 2) ||
			(password.length >= 12 && categories >= 3)

		return {
			ok,
			message: ok
				? score >= 5
					? "Looks strong. We will check breaches before continuing."
					: "Looks okay. A longer passphrase would be stronger."
				: "Use a longer passphrase or mix in another character type."
		}
	}

	async function checkPwned(password, signal) {
		const digest = await crypto.subtle.digest(
			"SHA-1",
			new TextEncoder().encode(password)
		)
		const hash = Array.from(new Uint8Array(digest))
			.map((byte) => byte.toString(16).padStart(2, "0"))
			.join("")
			.toUpperCase()
		const prefix = hash.slice(0, 5)
		const suffix = hash.slice(5)
		const response = await fetch(
			`https://api.pwnedpasswords.com/range/${prefix}`,
			{
				headers: { "Add-Padding": "true" },
				signal
			}
		)
		if (!response.ok) throw new Error("Pwned Passwords check failed")

		for (const line of (await response.text()).split("\n")) {
			const [candidate, count] = line.trim().split(":")
			if (candidate?.toUpperCase() === suffix) {
				return Number.parseInt(count ?? "0", 10) || 0
			}
		}
		return 0
	}

	window.composeryPasswordCheck = { checkPwned, checkStrength }
})()
