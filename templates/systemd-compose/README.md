# Composery - systemd, no bundled proxy

Composery with systemd as PID 1 (the closest shape to Composery Cloud), HTTP on `8080`.
Needs a privileged container with host cgroup access. Behind your own reverse proxy.

```bash
docker compose up -d        # then reach http://<host>:8080
```

Do not expose `8080` to the public internet without TLS in front.

**-> [Docker Compose on a VPS](../../docs/self-hosting/vps.md)**
