# What a machine needs

Everything the repository needs from the machine it is worked on, in one place. No script installs these: each one is a choice the person makes, and the part of the repository that needs one says which.

## Every machine

| Needs | For | Missing means |
|---|---|---|
| **Bun** (the version in `packageManager`) | every command | nothing runs |
| **Node** on the path (the major version in `engines`) | the Convex CLI, and the Convex backend's own runtime for Node actions | `bun dev` and the Convex tests fail |
| **Git** | the repository, and `bun test --changed` | no history to compare against |
| **Docker** | the SSH server that tests ask for answers | the tests that need `sshd` fail with a message |
| **The network, on a first test run** | downloading the pinned Convex backend and building the `sshd` image | the first run fails; later runs need nothing |

## Windows

Symbolic links must be allowed, which means Developer Mode or an administrator shell. This is a requirement of the repository itself, not of one file in it: `CLAUDE.md` is stored as a link, and a clone without the permission silently gets a one-line text file where the instructions should be.
