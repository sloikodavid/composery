# To-do

- Implement docs website, possibly GitHub pages, Fumadocs, or other. Docs content has to be in this repo.

- Error code: Out of Memory.

- Fix renovate or move off of it for update handling. Possibly slim down the codebase maintainment control surface/document maintaining/what things to keep updated, keep patches working, or detect when they don't, etc. Automate most whenever possible.

- Better mobile support.

- Figure out the API including Shortcuts.
  - Copy URL button for shortcuts - uses a Webhook for command shortcuts and passes payload.

- Enable rulesets on GitHub.

- Mirror the exact upstream release tarballs used by `Dockerfile` in a project-controlled location, such as an Composery GitHub release or GHCR artifact:
  - `code-server-<version>-linux-amd64.tar.gz`.
  - `code-server-<version>-linux-arm64.tar.gz`.
- Add CI automation to mirror new code-server assets after Renovate opens or merges a code-server update?

## Future Ideas:

- Product icon support.

- File/folder/workspace/shortcut/artifact sharing/collaboration.

- File router depending on host platform, possibly changing AGENTS.md instructions.

- Behavioral hooks for VS Code actions.
