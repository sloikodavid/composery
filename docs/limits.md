---
title: Disk and traffic
description: What a box can store and send, how to watch it, and what happens at the limits.
---

A box can run out of two things: disk space and its monthly outbound traffic
allowance. Both are shown as meters on the box's page, and Composery emails the
owner before either runs out.

Nothing on this page applies to a self-hosted Composery. There the disk is the
volume you attached and the traffic is your host's to meter, so the runtime
sets no limit of its own and sends no notice.

## Disk

The disk is the one the plan includes. The meter reports the box's own
filesystem, so it counts everything on the machine: your files, the packages you
installed, and the Docker images and build cache inside the box.

Docker is usually the largest of those. To reclaim space, open a terminal in the
box and run:

```bash
docker system df
docker image prune -a -f
docker builder prune -a -f
```

`df -h /` then shows what is left. [Disk space](self-hosting/disk-space.md)
explains what each command removes.

A full disk stops the box writing anything. The editor, the persistence daemon
and any snapshot taken while it is full are all affected, so treat the first
warning as the moment to act.

## Outbound traffic

Every plan includes an outbound traffic allowance each month. The figure is on
the plan's card on the [pricing page](https://www.composery.io/pricing).

- **Outbound only.** Traffic arriving at the box is not counted.
- **Monthly.** The counter starts again at the beginning of the box's billing
  month. The box page says when it last reset.
- **Measured at the provider.** The figure is the one the host charges on, not an
  estimate taken inside the box.

Serving a site, sending builds or backups out, and pulling large container images
are what usually move it.

## What Composery does

Composery emails the box owner at **80%** of an allowance and again at **95%**.
Each email says which limit, how much is used, and what to do about it. A limit
that stays high does not send another email until it crosses a step it had not
crossed before, and the counter resetting clears that.

Passing an allowance does not switch the box off. Sustained excess is something
Composery gets in touch about; see the
[Terms of Service](https://www.composery.io/terms).

This is separate from the abuse protection, which watches the **rate** a box
sends at over a sustained period rather than a total spent over a month. That one
can suspend a box automatically.

## Reading the meters

The box page shows both meters with the figures behind them ("38.2 GB of 40 GB")
and the time the reading was taken. Disk is measured hourly, traffic on the same
schedule as the box's other metrics, so a meter can lag a burst by a few minutes.

A meter reading **Unknown** means the reading failed, not that the box is using
nothing. A box that has never run has no reading at all and shows no meters.
