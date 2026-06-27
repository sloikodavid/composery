---
title: Composery
description: A Debian-style VPS in your browser - install packages, edit system files, build projects, and keep that state across restarts.
---

Composery feels like a small Debian-style VPS in a browser. You get a real Linux
machine: install packages, edit system files, build projects - and that state survives
restarts. The runtime is a container, so durable state comes from one volume mounted
at `/data` (see [Persistence](persistence.md)).

## The environment

You log into a real user account, not a locked-down shell:

- You are `user`, a normal account with passwordless `sudo` - root whenever you need it.
- `user` owns `/usr/local`, so `npm i -g`, `make install`, and `curl ... | sh` installers.
  that target `/usr/local/bin` work without `sudo`.
- `~/.local/bin` and `~/bin` are on `PATH` for every shell - including ones an AI agent.
  or task spawns with `bash -c`, not just the interactive terminal.
- `cron` runs, so `crontab -e` schedules jobs.
- The locale defaults to `C.UTF-8`; override it per session if you need to.

Your changes persist across restarts through the [persistence](persistence.md) daemon,
which writes only your deltas to `/data`. Configure the runtime with
[environment variables](configuration.md).

## Running Composery

- **Self-host it** - [deployment guides](self-hosting/index.md) for a VPS (Docker.
  Compose), Fly, Render, Railway, and Kubernetes.
- **Composery Cloud** - the hosted offering at.
  [composery.io](https://www.composery.io/pricing), running the same runtime.
