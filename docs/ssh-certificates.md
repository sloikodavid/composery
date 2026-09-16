# SSH certificates

Not built, and not decided. This note exists so that a later attempt starts from the reasoning instead of from nothing. `docs/decisions.md` holds what is actually decided; everything here is a sketch, with the basis of each claim named. The session that produced it is `sessions/2026-09-15-claude-ssh.md`.

## What a certificate would change

Composery pins each server's host key at creation, through an authenticated report. That protects Composery's own connections and nothing else: a customer who types `ssh root@<address>` still meets the ordinary "authenticity of host can't be established" prompt, and an address that Hetzner recycles can impersonate a deleted server to them.

A **host certificate** moves that trust to a name. Composery's certificate authority signs a server's host key, with the server's name as the certificate's principal. A customer adds one `@cert-authority` line to their `known_hosts` once, for every server they will ever have, and their client then verifies any Composery server by name and refuses an impostor. A host key that the customer regenerates stops being an incident and becomes a re-signing.

A **user certificate** is a different feature: short-lived certificates for people instead of keys in a file. It costs client tooling for every person who connects, and it is not proposed here.

## What it would require

1. **A name for each server.** A principal is a name, so this waits for the naming scheme that the app feature will define. This is the reason the decision is deferred, not the cost of the cryptography.
2. **A certificate authority key.** Generated once, held as a deployment secret, never present on a server, with a rotation plan: publish the new authority, let clients trust both, re-sign, then retire the old one. Teleport's documented rotation is phased for exactly this reason.
3. **Signing.** An internal action signs one certificate for one allocation: principal is that server's name, lifetime short enough that expiry is a real control (30 to 90 days), renewed by the existing worker once inside the renewal window. Serials are allocated and committed before signing, never reused, and never zero, because a zero serial makes OpenSSH fall back to revoking by key identity.
4. **Installation.** sshd needs a `HostCertificate` line, so creation writes a Composery drop-in under `/etc/ssh/sshd_config.d/`. That is provisioning our own file, not editing the customer's configuration, and renewal then replaces only the certificate file. A customer who deletes either one simply falls back to what they have today.
5. **Revocation, which is asymmetric and easy to get wrong.** For *host* certificates the revocation list is a **client-side** file (`RevokedHostKeys` in `ssh_config`), so Composery cannot revoke one on the customer's behalf; short lifetimes are the real control. For *user* certificates the list lives on the server (`RevokedKeys` in `sshd_config`), which is the case where distribution to every server is part of the feature. An abandoned earlier prototype wrote revocation records to a database and never generated a list at all, so nothing was ever revoked.

## What must stay true either way

- **A server name is permanent and never reused.** Composery already guarantees this so a server can rename back to its own history. Certificates make it load-bearing: a name that once identified a server must never point at another one, or old client configuration trusts a stranger.
- **A rename needs an overlap.** A certificate carrying both the old and the new name, until clients and DNS have caught up.
- **The pin stays.** Composery's own trust should not depend on the same authority it issues, and a certificate is one more line beside the existing pin rather than a replacement for it.
- **The customer can undo all of it**, and the product says so plainly rather than promising enforcement it does not have.

## What would make this worth doing

Any of: the app naming scheme lands and servers get names anyway; customers report the first-connection warning as friction; or the number of servers makes individual host key pins a support burden.

## Basis

- `research/2026-09-14-ssh-host-key-trust-methods.md` and `research/2026-09-15-ssh-trust-recovery-methods.md` for the comparison of pinning, certificates, DNS and provider channels, with the counterexamples for each.
- An abandoned earlier prototype in a sibling repository, which implemented host-certificate-only issuance with 90 day lifetimes, pre-allocated serials and a name tombstone rule, and never shipped its revocation list. Its code was not read into this repository, and none of it is evidence of correctness.
