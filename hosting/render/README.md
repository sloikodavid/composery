# Composery on Render

Render provides the public HTTPS edge and an attachable persistent disk, so Composery
runs as a single Docker-image web service with the disk mounted at `/data`. No Caddy.

## Deploy

1. Push a repository containing this `render.yaml` (or point Render at this repo).
2. In the Render dashboard, choose **New > Blueprint** and select the repository.
3. Render reads `render.yaml`, creates the web service, and attaches the disk.

You can also wire a one-click button into your own README:

```markdown
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/sloikodavid/composery)
```

Open the service URL Render assigns. Register the initial password in the browser, or
set `PASSWORD` / `HASHED_PASSWORD` as a service environment variable.

## Notes

- **A persistent disk requires a paid instance type.** Free web services have an.
  ephemeral filesystem, so Composery state would not survive a redeploy there.
- A service with a disk cannot be scaled past one instance - which matches Composery's.
  single-writer `persistd` model.
- `PORT` is set to `8080`; Render routes to it and health-checks `/healthz`.
- Back up the disk before major image upgrades.
