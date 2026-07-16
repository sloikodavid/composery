(() => {
	const href = document.getElementById("href")
	if (href) href.value = location.href

	for (const input of document.querySelectorAll(
		".monaco-inputbox > .ibwrapper > .input"
	)) {
		const inputBox = input.closest(".monaco-inputbox")
		input.classList.toggle("empty", !input.value)
		input.addEventListener("focus", () =>
			inputBox?.classList.add("synthetic-focus")
		)
		input.addEventListener("blur", () =>
			inputBox?.classList.remove("synthetic-focus")
		)
		input.addEventListener("input", () =>
			input.classList.toggle("empty", !input.value)
		)
		if (!input.closest("[data-password-flow]")) {
			input.addEventListener("keydown", (event) => {
				if (event.key === "Enter") {
					event.preventDefault()
					input.form?.requestSubmit()
				}
			})
		}
	}

	const flow = document.querySelector("[data-password-flow]")
	if (!flow || !window.composeryPasswordCheck) return

	const form = flow.closest("form")
	const passwordInput = flow.querySelector("[data-password-input]")
	const confirmInput = flow.querySelector("[data-password-confirm]")
	const passwordStatus = flow.querySelector("[data-password-status]")
	const confirmStatus = flow.querySelector("[data-confirm-status]")
	const submitButton = form?.querySelector("[data-password-submit]")
	const submitText = submitButton?.querySelector("span")
	if (
		!form ||
		!passwordInput ||
		!confirmInput ||
		!passwordStatus ||
		!confirmStatus ||
		!submitButton ||
		!submitText
	) {
		return
	}

	const submitLabel = submitButton.dataset.submitLabel
	let readyToSubmit = false
	let breachController
	let breach = { password: "", status: "idle" }

	function setStatus(element, message, tone) {
		element.textContent = message
		element.classList.remove("success", "warning", "destructive")
		if (tone) element.classList.add(tone)
	}

	function currentBreach() {
		return breach.password === passwordInput.value
			? breach
			: { password: passwordInput.value, status: "idle" }
	}

	function renderPassword() {
		const password = passwordInput.value
		const strength = window.composeryPasswordCheck.checkStrength(password)
		const check = currentBreach()
		let message = password ? strength.message : ""
		let tone = password && !strength.ok ? "warning" : undefined
		let label = password && !strength.ok ? "Use anyway?" : submitLabel
		let variant = password && !strength.ok ? "warning" : undefined

		if (check.status === "checking") {
			message = "Checking known breaches."
			tone = undefined
		} else if (check.status === "found") {
			message = `Found in ${new Intl.NumberFormat("en").format(check.count)} breach records. Not recommended.`
			tone = "destructive"
			label = "Use anyway?"
			variant = "destructive"
		} else if (check.status === "clear") {
			message = "Not found in known breaches."
			tone = "success"
		} else if (check.status === "unavailable") {
			message = "Breach check unavailable. You can continue."
			tone = "warning"
		}

		setStatus(passwordStatus, message, tone)
		passwordInput.setAttribute(
			"aria-invalid",
			check.status === "found" ? "true" : "false"
		)
		submitText.textContent = label
		submitButton.classList.remove("warning", "destructive")
		if (variant) submitButton.classList.add(variant)
		submitButton.disabled = check.status === "checking"
		submitButton.setAttribute(
			"aria-busy",
			check.status === "checking" ? "true" : "false"
		)
	}

	function renderConfirmation() {
		if (!confirmInput.value) {
			confirmInput.removeAttribute("aria-invalid")
			setStatus(confirmStatus, "")
			return
		}
		const matches = confirmInput.value === passwordInput.value
		confirmInput.setAttribute("aria-invalid", matches ? "false" : "true")
		setStatus(
			confirmStatus,
			matches ? "Matches" : "Does not match",
			matches ? "success" : "destructive"
		)
	}

	async function checkBreach(password) {
		const existing = currentBreach()
		if (existing.status === "checking") return "checking"
		if (["clear", "found", "unavailable"].includes(existing.status)) {
			return existing.status
		}

		breachController?.abort()
		breachController = new AbortController()
		breach = { password, status: "checking" }
		renderPassword()
		try {
			const count = await window.composeryPasswordCheck.checkPwned(
				password,
				breachController.signal
			)
			if (passwordInput.value !== password) return "unavailable"
			breach = {
				count,
				password,
				status: count > 0 ? "found" : "clear"
			}
		} catch {
			if (passwordInput.value !== password) return "unavailable"
			breach = { password, status: "unavailable" }
		}
		renderPassword()
		return breach.status
	}

	async function checkAndSubmit() {
		if (!form.checkValidity()) {
			form.reportValidity()
			return
		}
		if (passwordInput.value !== confirmInput.value) {
			renderConfirmation()
			confirmInput.focus()
			return
		}

		const password = passwordInput.value
		const alreadyBreached = currentBreach().status === "found"
		const result = await checkBreach(password)
		if (passwordInput.value !== password || result === "checking") return
		if (result === "found" && !alreadyBreached) return

		readyToSubmit = true
		form.requestSubmit(submitButton)
	}

	passwordInput.addEventListener("input", () => {
		breachController?.abort()
		readyToSubmit = false
		breach = { password: "", status: "idle" }
		renderPassword()
		renderConfirmation()
	})
	confirmInput.addEventListener("input", () => {
		readyToSubmit = false
		renderConfirmation()
	})
	form.addEventListener("submit", (event) => {
		if (readyToSubmit) return
		event.preventDefault()
		void checkAndSubmit()
	})

	renderPassword()
	renderConfirmation()
})()
