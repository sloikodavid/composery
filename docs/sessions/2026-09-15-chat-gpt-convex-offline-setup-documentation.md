# Convex Offline Setup Documentation

Source: https://chatgpt.com/share/6aa9cd81-e694-83ed-93ee-325601f278b8

---

## Turn 1: User

_2026-09-15T22:51:56.405Z_

For a self-hosted Convex backend used in tests: what does it need from the network on a
first function push, how can that be made to work offline or cached, and what is the
documented way to set environment variables and admin keys for it? Say what is documented
versus what is community practice.

---

## Turn 2: ChatGPT

_2026-09-15T22:52:13.791Z_

I’ll separate the official self-hosting/CLI documentation from what people commonly do in CI or fully offline test environments, because those aren’t always the same.

---

## Turn 3: ChatGPT

_2026-09-15T22:52:26.342Z_

The official docs are clear on self-hosted credentials and deployment env vars. The “first push/offline” part is less formally documented, so I’m checking the backend/CLI implementation and issue history to avoid presenting a workaround as an official contract.

---

## Turn 4: ChatGPT

_2026-09-15T22:53:59.076Z_

For a self-hosted Convex backend used in tests, the important distinction is whether your pushed functions use **external Node packages**.

| Situation | Network requirement | Status |
|---|---|---|
| Normal bundled functions | The Convex CLI bundles code and dependencies locally with esbuild, then talks to your self-hosted backend. There is no server-side npm install. ([Convex Developer Hub](https://docs.convex.dev/functions/bundling?utm_source=chatgpt.com)) | **Documented** |
| First push with `node.externalPackages` | The backend needs outbound access to install those packages from npm. Convex documents that external packages are installed from npm on first use and cached thereafter. ([Convex Developer Hub](https://docs.convex.dev/functions/bundling?utm_source=chatgpt.com)) | **Documented** |
| Unchanged external packages on later pushes | Convex reuses its cached external-dependency package instead of reinstalling it. ([Convex Developer Hub](https://docs.convex.dev/functions/bundling?utm_source=chatgpt.com)) | **Documented** |
| Backend telemetry/beacon | A self-hosted backend may also make a separate telemetry/beacon request; that is not needed for deployment and can be disabled with `DISABLE_BEACON`/`--disable-beacon`. ([GitHub](https://github.com/get-convex/convex-backend?utm_source=chatgpt.com)) | **Documented** |

The implementation makes the external-package requirement particularly clear: on a cache miss the self-hosted Node executor constructs a temporary `package.json` containing the exact package versions and literally executes `npm install`, then zips the resulting `node_modules` for Convex to store.  The backend itself logs the distinction between an external-dependency cache hit and a cache miss that invokes `build_deps`. 

So if you firewall the test backend, the first external-package push potentially needs more than one hostname. Normally npm registry metadata and tarballs are involved, and a dependency's lifecycle scripts can themselves download binaries or other assets. In other words, "`registry.npmjs.org` only" is not a universally safe allowlist for arbitrary external packages.

### Making tests offline or cacheable

The cleanest **documented** solution is to avoid `node.externalPackages` when you can. Convex normally bundles dependencies into the function bundle; externalization is an escape hatch for things such as native binaries, dynamic dependencies, or libraries esbuild cannot bundle. ([Convex Developer Hub](https://docs.convex.dev/functions/bundling?utm_source=chatgpt.com)) If everything is bundled and your project dependencies/Convex CLI are already installed, a push to a localhost self-hosted backend can be isolated from the Internet.

If you require external packages, Convex documents the caching behavior but does **not** document a first-class "prime this deployment for completely offline npm installs" command. The practical approaches are therefore partly community/implementation practice:

- **Warm the Convex deployment once, then preserve its backend state/storage.** Push the exact external dependency set while networking is allowed, then reuse that deployment or its persistent Docker volume for tests. Because Convex's external-dependency artifact is cached, unchanged dependencies won't invoke `npm install` again. Recreating a completely fresh backend for every test removes that benefit.
- **Use an internal npm proxy/mirror** such as Verdaccio, Artifactory, or Nexus and give the backend `NPM_CONFIG_REGISTRY` pointing at it. This is standard npm practice, not a Convex-documented configuration interface.
- **Pre-populate and mount npm's cache and use npm offline configuration.** The current self-hosted implementation runs plain `npm install` and inherits process environment. For local/file-backed self-hosting it notably does not replace npm's normal cache location; for other upload modes the code can put the cache under its temporary build directory.  Thus people can mount an npm cache and use things such as `NPM_CONFIG_OFFLINE=true`, but that depends on implementation details and is **not a documented Convex guarantee**.
- A "golden" warmed `/convex/data` Docker volume is generally more robust than relying only on npm's cache, because you preserve Convex's already-built external-dependency artifact rather than asking npm to reconstruct it offline. The official backend image declares `/convex/data` as its persistent volume. 

If a package's `postinstall` fetches something outside npm, even a fully populated npm metadata/tarball cache can be insufficient. An already-warmed Convex dependency artifact avoids that install path entirely.

### Admin key and CLI configuration

For **self-hosted Convex**, the documented Docker flow is:

```sh
docker compose exec backend ./generate_admin_key.sh
```

Then configure the project/CLI with:

```dotenv
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
CONVEX_SELF_HOSTED_ADMIN_KEY=<generated-admin-key>
```

The self-hosting guide specifically says to put those in `.env.local` and not commit it. ([GitHub](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md?utm_source=chatgpt.com)) For scripted one-off deployments, `npx convex deploy --env-file <file>` is also documented, so tests can create an ephemeral env file rather than modifying the checkout. ([Convex Developer Hub](https://docs.convex.dev/cli/reference/deploy?utm_source=chatgpt.com))

If you run the backend binary directly rather than Docker, the documented lower-level mechanism is to create an `INSTANCE_SECRET`, start the backend with that secret, and derive an admin key using Convex's `generate_key`/keybroker tooling. The instance secret is the root credential; rotating it invalidates generated keys. ([GitHub](https://github.com/get-convex/convex-backend/blob/main/self-hosted/advanced/running_binary_directly.md?utm_source=chatgpt.com))

I would use the dedicated `CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY` pair for test self-hosting rather than treating a self-hosted admin key as a normal cloud `CONVEX_DEPLOY_KEY`. That's the path the self-hosting documentation explicitly specifies. ([GitHub](https://github.com/get-convex/convex-backend/blob/main/self-hosted/README.md?utm_source=chatgpt.com))

### Function environment variables are separate

Don't confuse the Docker/backend process environment with the environment available to Convex functions.

The documented way to set **deployment/function environment variables** is through the Convex deployment, either in the dashboard or with the CLI:

```sh
npx convex env list
npx convex env get NAME
npx convex env set NAME 'value'
npx convex env set --from-file .env.convex
npx convex env remove NAME
```

Those variables are per deployment and are exposed to functions through the declared `env` configuration or `process.env`. ([Convex Developer Hub](https://docs.convex.dev/production/environment-variables?utm_source=chatgpt.com)) Setting an arbitrary variable on the `docker compose` `backend:` container is therefore not the documented way to populate a function's `process.env`; container env is for configuring the Convex server itself.

So for a hermetic CI/test setup, I'd arrange it as: install JS dependencies ahead of time, start a self-hosted backend with a persistent/warmed data volume, disable the beacon, supply the self-hosted URL/admin key via an ephemeral env file, run `convex env set --from-file` for test-specific function secrets, and then push. If you can eliminate `externalPackages`, that setup can be genuinely network-isolated; if you cannot, prime the external-dependency cache before cutting network access.
