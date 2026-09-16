# Convex

One deployment for each environment. A deployment holds its own data, environment variables, crons, and HTTP routes, so a production deployment needs every variable in `.env.convex.example` set again with production values, including a new `SSH_ACCESS_ENCRYPTION_KEYS`.

## Backups

Convex backs up one deployment at a time, from the dashboard's backup page.

- **Manual backups** are kept for 7 days. **Periodic daily or weekly backups need a Pro plan**; daily copies are kept for 7 days and weekly copies for 14. A deployment on the free plan keeps at most two backups at once.
- **Download** a backup from the dashboard, or with `bunx convex export --path <directory>`. The file is a ZIP of JSON documents, which `bunx convex import` restores into the same deployment or another one.
- **Restoring replaces everything.** The restore wipes the deployment's data first, so never test a restore against a deployment that holds real data.
- **A backup holds data only.** Code, environment variables, and scheduled functions that have not run yet are not in it.

That last point decides what has to be kept somewhere else, because losing it cannot be repaired from a backup:

- **`SSH_ACCESS_ENCRYPTION_KEYS`.** Every allocation's management key is encrypted with the first key in this list. Without a key that encrypted a value, Composery can never sign in to the server it belongs to, and the customer cannot be given that access back. `docs/setups/hetzner-cloud.md` says how to rotate it.
- **The other environment variables**, so a deployment can be rebuilt.

Restoring data alone also does not restore infrastructure: rows describe servers that Hetzner still owns. After any restore, compare `serverAllocations` and `hetznerCloudAllocations` with the project's real resources before letting the worker run, or it acts on stale state.

## Rotating the SSH access keys

Set `SSH_ACCESS_ENCRYPTION_KEYS` to 32 cryptographically random bytes encoded as base64. Pipe the value into `convex env set SSH_ACCESS_ENCRYPTION_KEYS` without displaying it. Keep a secure backup; losing every key in the list makes the stored SSH access secrets unreadable, and no customer can be given that access back. Each allocation has a separate Ed25519 management key, encrypted with AES-256-GCM and bound to its allocation ID.

The setting is an ordered, comma-separated list. The first key encrypts every new value, and every key in the list can read one. Each envelope records which key encrypted it, so rotation is three steps and its progress is a fact rather than a hope:

1. Append the new key: `K_old,K_new`. Every reader now knows it; nothing uses it yet.
2. Move it to the front: `K_new,K_old`. New values are encrypted with it; old ones still read.
3. Run `convex run ssh/secrets:reEncrypt '{}'`. It reports how many values it encrypted again and which keys are still named. When only the new key is named, remove the old one from the list.

Doing this in one step would leave values that a deployment still holding only the old key cannot read. Never overwrite the list with a single new key while allocations hold secrets encrypted by the old one.
