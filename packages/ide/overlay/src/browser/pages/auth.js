(() => {
	const href = document.getElementById("href")
	if (href) href.value = location.href

	// Staged single-input flow: every auth page is a list of [data-stage]
	// sections showing one input at a time, with the crumb row as both label
	// and back-navigation and one fixed status line under the input. The same
	// engine runs one-stage pages (login) and multi-stage ones (register,
	// change-password); the cloud error page has no stages and no form logic.
	const form = document.querySelector(".auth-form")
	const stages = form ? Array.from(form.querySelectorAll("[data-stage]")) : []
	const status = form ? form.querySelector("[data-status]") : null
	const submit = form ? form.querySelector('.submit-button[type="submit"]') : null
	const submitText = submit ? submit.querySelector("span") : null
	if (!form || !stages.length || !status || !submit || !submitText) return

	const crumbs = Array.from(form.querySelectorAll("[data-crumb]"))
	const inputs = stages.map((stage) => stage.querySelector("input"))
	const passwordIndex = inputs.findIndex((input) =>
		input?.hasAttribute("data-password-input")
	)
	const confirmIndex = inputs.findIndex((input) =>
		input?.hasAttribute("data-password-confirm")
	)
	const passwordCheck =
		passwordIndex >= 0 ? window.composeryPasswordCheck : undefined

	let current = 0
	let readyToSubmit = false
	// The server-rendered error (wrong password, rate limit) owns the status
	// line until the user interacts; then the stage messaging takes over.
	let serverError = !!status.textContent.trim()
	let breach = { password: "", status: "idle" }
	let breachController

	function currentBreach() {
		return passwordIndex >= 0 && breach.password === inputs[passwordIndex].value
			? breach
			: { password: inputs[passwordIndex]?.value ?? "", status: "idle" }
	}

	function setStatus(message, tone) {
		status.textContent = message
		status.classList.remove("success", "warning", "destructive")
		if (tone) status.classList.add(tone)
	}

	function renderStatus() {
		if (serverError) return
		if (current === passwordIndex && passwordCheck) {
			const input = inputs[passwordIndex]
			const check = currentBreach()
			if (check.status === "checking") {
				setStatus("Checking known breaches.")
			} else if (check.status === "found") {
				setStatus(
					`Found in ${new Intl.NumberFormat("en").format(check.count)} breach records.`,
					"destructive"
				)
			} else if (input.value) {
				setStatus(passwordCheck.checkStrength(input.value).message)
			} else {
				setStatus("")
			}
			input.setAttribute(
				"aria-invalid",
				check.status === "found" ? "true" : "false"
			)
		} else if (current === confirmIndex) {
			const input = inputs[confirmIndex]
			if (!input.value) {
				input.removeAttribute("aria-invalid")
				setStatus("")
				return
			}
			const matches = input.value === inputs[passwordIndex]?.value
			input.setAttribute("aria-invalid", matches ? "false" : "true")
			setStatus(
				matches ? "Matches" : "Does not match",
				matches ? "success" : "destructive"
			)
		} else {
			setStatus("")
		}
	}

	function renderSubmit() {
		const check = currentBreach()
		let label = stages[current].dataset.button
		let variant
		if (current === passwordIndex && passwordCheck) {
			const value = inputs[passwordIndex].value
			if (check.status === "found") {
				label = "Use anyway?"
				variant = "destructive"
			} else if (value && !passwordCheck.checkStrength(value).ok) {
				label = "Use anyway?"
				variant = "warning"
			}
		}
		submitText.textContent = label
		submit.classList.remove("warning", "destructive")
		if (variant) submit.classList.add(variant)
		const checking = current === passwordIndex && check.status === "checking"
		submit.disabled = checking
		submit.setAttribute("aria-busy", checking ? "true" : "false")
	}

	function render() {
		stages.forEach((stage, index) =>
			stage.toggleAttribute("hidden", index !== current)
		)
		for (const crumb of crumbs) {
			const index = Number(crumb.dataset.crumb)
			crumb.toggleAttribute("hidden", index > current)
			if (crumb.matches("button")) {
				if (index === current) crumb.setAttribute("aria-current", "step")
				else crumb.removeAttribute("aria-current")
			}
		}
		renderStatus()
		renderSubmit()
	}

	function setStage(index) {
		current = index
		render()
		inputs[index]?.focus()
	}

	async function checkBreach(password) {
		const existing = currentBreach()
		if (existing.status !== "idle") return existing.status
		breachController?.abort()
		breachController = new AbortController()
		breach = { password, status: "checking" }
		render()
		try {
			const count = await passwordCheck.checkPwned(
				password,
				breachController.signal
			)
			if (inputs[passwordIndex].value !== password) return "unavailable"
			breach = { count, password, status: count > 0 ? "found" : "clear" }
		} catch {
			if (inputs[passwordIndex].value !== password) return "unavailable"
			breach = { password, status: "unavailable" }
		}
		render()
		return breach.status
	}

	async function advance() {
		const input = inputs[current]
		if (input && !input.reportValidity()) return
		if (current === passwordIndex && passwordCheck) {
			const password = input.value
			// A breach found by this click only reveals its red state; using the
			// password anyway takes a second, informed click. An unavailable
			// check never blocks - it just proceeds unchecked.
			const alreadyBreached = currentBreach().status === "found"
			const result = await checkBreach(password)
			if (inputs[passwordIndex].value !== password) return
			if (result === "checking") return
			if (result === "found" && !alreadyBreached) return
		}
		if (current === confirmIndex && input.value !== inputs[passwordIndex]?.value) {
			serverError = false
			renderStatus()
			input.focus()
			return
		}
		if (current < stages.length - 1) {
			serverError = false
			setStage(current + 1)
			return
		}
		readyToSubmit = true
		form.requestSubmit(submit)
	}

	inputs.forEach((input, index) => {
		input?.addEventListener("input", () => {
			serverError = false
			readyToSubmit = false
			if (index === passwordIndex) {
				breachController?.abort()
				breach = { password: "", status: "idle" }
			}
			renderStatus()
			renderSubmit()
		})
	})

	for (const crumb of crumbs) {
		if (!crumb.matches("button")) continue
		crumb.addEventListener("click", () => {
			const index = Number(crumb.dataset.crumb)
			if (index >= current) return
			serverError = false
			readyToSubmit = false
			setStage(index)
		})
	}

	form.addEventListener("submit", (event) => {
		if (readyToSubmit) return
		event.preventDefault()
		void advance()
	})

	render()
})()
