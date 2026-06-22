# Composery

Composery is a persistent, VPS-like Linux appliance with code-server in the browser.
It runs as one container, but `persistence` stores root filesystem changes on a single
mounted `/data` volume so installed packages, edited config, CLI state, projects,
and user files survive restarts and image upgrades.

## Quick Start

```bash
docker compose up --build
```

Open `http://localhost:8080` and sign in with the password from `compose.yml`.
For local development the default password is `12345`; change it before exposing
the container to a network.

## Self-Hosting

For a real domain and automatic HTTPS, use the Caddy example:

```bash
cd hosting/supervisor-caddy-compose
# edit Caddyfile and replace example.com with your domain
docker compose up -d
```

For a host-integrated VPS with systemd inside the runtime container, use
`hosting/systemd-caddy-compose` instead. Managed platforms with a persistent disk
have ready-made templates: [hosting/render](hosting/render/),
[hosting/fly](hosting/fly/), [hosting/railway](hosting/railway/), and
[hosting/kubernetes](hosting/kubernetes/). The [hosting/](hosting/) index routes every
target by host capability and TLS edge; [docs/self-hosting.md](docs/self-hosting.md)
covers deployment targets, operational notes, and the persistence contract.

On first visit, the browser registration flow creates the initial password. If
you deliberately want an environment-managed password instead, set code-server's
standard `PASSWORD` or `HASHED_PASSWORD` variable in the example's
`composery.env`.

Composery does not define `COMPOSERY_*` runtime wrappers around code-server
settings. Use code-server environment variables directly.

## Deployment Shape

Composery currently needs:

- one Composery container;
- one persistent volume mounted at `/data`;
- one HTTP edge, usually Caddy, nginx, Traefik, or a platform proxy;
- root inside the container so `persistence` can rebuild the filesystem on boot.

The production cloud repo deploys this shape on Hetzner VPSes with Docker Compose
and Caddy, using the systemd init profile.

Do not run multiple Composery containers against the same `/data` volume. `persistence`
is a single-writer filesystem delta daemon.
