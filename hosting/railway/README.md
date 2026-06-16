# Composery on Railway

Railway provides the public HTTPS edge and a persistent volume, so Composery runs as a
single service with the volume mounted at `/data`. No Caddy.

Railway provisions volumes and the image source at the service level (in the dashboard
or a published template), not from a repo file. `railway.json` here only carries the
deploy settings Railway reads as config-as-code (health check, restart policy, single
replica).

## Deploy from the image

1. **New Project > Deploy from Docker Image** and enter.
   `ghcr.io/sloikodavid/composery:latest`.
2. Right-click the service > **Attach Volume**, mount path `/data`.
3. Set service variables: `PORT=8080` (register the password in the browser, or set.
   `PASSWORD` / `HASHED_PASSWORD`).
4. **Settings > Networking > Generate Domain**, target port `8080`.

## Publish a one-click template

Once a project deploys cleanly, open **project Settings > publish as a template** to get
a shareable template and a deploy button for your README:

```markdown
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/template/<your-template-code>)
```

The template must keep the volume attached at `/data` so deployments stay persistent.

## Notes

- Run a single replica; `persistd` is a single writer for one `/data` volume.
- Railway volumes are attached at runtime - after first boot, confirm persistence with.
  `persistd status --json` in the service shell.
