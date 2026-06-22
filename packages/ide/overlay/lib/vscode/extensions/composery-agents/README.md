# Composery Agents

Builtin extension that registers `composery.installAgent`, the command behind the
"Set up an AI coding agent" cards on the Composery welcome page.

Given an agent id it opens a dedicated, visible terminal and runs that agent's
official, documented setup command; the user then handles any login or onboarding
the agent prompts for. Run with no id (the `Composery: Set Up an AI Coding Agent`
palette entry) to pick from the list instead.

`AGENTS` in `extension.js` is the single source of truth for the setup commands.
The welcome card in `packages/ide/patches/welcome.diff` references the same
agent ids and ships their logos under `overlay/src/browser/media/agents/`.
