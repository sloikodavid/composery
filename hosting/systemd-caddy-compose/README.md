# Composery - systemd + Caddy

Composery behind Caddy with automatic HTTPS, systemd as PID 1. The closest self-hosted
shape to Composery Cloud on a Hetzner-style VPS. Needs a privileged container with host
cgroup access.

```bash
# edit Caddyfile (your domain) and optionally composery.env
docker compose up -d        # then open https://<your-domain>
```

**-> [Docker Compose on a VPS](../../docs/self-hosting/vps.md)**
