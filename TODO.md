# To-do

- Make all color codes be covered, change monospace font, possibly making main editor content not use monospace as well.

- Solidify/set default code-server settings, IndexedDB, all other code-server state, etc.

- Change default Extensions tab Popular API call query params to be less dev-heavy somehow? Same for default Command Center suggestions, as well as the empty screen shortcut suggestions - under the letterpress.

- Strip chat/copilot functionality completely, or maybe selectively so it keeps autocomplete or something? Maybe same for account?

- Implement docs website, possibly GitHub pages, Fumadocs, or other. Docs content has to be in this repo.

- Error code: Out of Memory.

- Fix renovate or move off of it for update handling. Possibly slim down the codebase maintainment control surface/document maintaining/what things to keep updated. Automate most whenever possible.

- Figure out the API including Shortcuts.
  - Copy URL button for shortcuts - uses a Webhook for command shortcuts and passes payload.

- Enable rulesets on GitHub.

- Mirror the exact upstream release tarballs used by `Dockerfile` in a project-controlled location, such as an Composery GitHub release or GHCR artifact:
  - `code-server-<version>-linux-amd64.tar.gz`.
  - `code-server-<version>-linux-arm64.tar.gz`.
- Add CI automation to mirror new code-server assets after Renovate opens or merges a code-server update?

## Future Ideas:

- File/folder/workspace/shortcut/artifact sharing/collaboration.

- File router depending on host platform, possibly changing AGENTS.md instructions.

- Behavioral hooks for VS Code actions.
