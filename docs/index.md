---
title: What is it?
description: Composery is a secure cloud computer with a powerful UI, usable from any phone or browser.
---

It's like VS Code, but it sits on a server, and is thus reachable from any browser or phone whenever. You get a real Linux system: install packages, edit system files, run agents, build projects - and that state survives restarts. The runtime is a container, so durable state comes from one volume mounted at `/data` (see [Persistence](persistence.md)).

## The environment

- You are `user`, a normal account with passwordless `sudo` - root whenever you need it.
- `cron` runs, so `crontab -e` schedules jobs.
- For incoming network requests, see [webhooks](api.md#webhooks).

Your changes persist across restarts through the [persistence](persistence.md) daemon,
which writes only your deltas to `/data`. Configure the runtime with
[environment variables](configuration.md).

## Running Composery

- **Self-host it** - [deployment guides](self-hosting/index.md) for Render, Railway, DigitalOcean, Fly.io, Koyeb, a VPS, Kubernetes, and other platforms (Coolify, Dokploy, Elestio, ...).
- **Composery Cloud** - the hosted offering at [composery.io](https://www.composery.io/pricing), running the same image, but managed for you.
