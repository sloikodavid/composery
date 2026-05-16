# To-do

- Mirror the exact upstream release tarballs used by `Dockerfile` in a project-controlled location, such as an Agentbox GitHub release or GHCR artifact:
  - `code-server-<version>-linux-amd64.tar.gz`.
  - `code-server-<version>-linux-arm64.tar.gz`.
- Add CI automation to mirror new code-server assets after Renovate opens or merges a code-server update?
- Revisit patch stack vs dedicated code-server fork if patches become broad.

- Husky properly working under dev edge cases i.e. keeping check passing parts unstaged.

- UI mobile support.

- Figure out the API including Shortcuts.
  - Copy URL button for shortcuts - uses a Webhook for command shortcuts and passes payload.

- The OSS image can be safe and simple, but cloud can do more:
  - run the same Agentbox image with managed infrastructure around it.
  - easy domains and TLS.
  - wildcard DNS/TLS for native code-server port proxy configuration.
  - nicer identity/access UX without changing the image contract.
  - relay/tunnel behavior only as infrastructure plumbing.
  - zero-ops examples/docs-equivalent setup, not a separate product surface.
  - managed HTTPS.
  - private code-server auth.
  - one-click public webhook endpoints.
  - generated secrets.
  - per-endpoint logs.
  - runsc/sandboxing.
  - backups.
  - abuse controls.

- Enable rulesets on GitHub.

- File/folder/workspace/shortcut sharing?
