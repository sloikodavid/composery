# Composery - user-data

Optional. Only for people who want a hands-off install - if you pick any other method, you
do not need this.

`user-data.yaml` - hand it to a fresh VPS's **user data** field (DigitalOcean, Hetzner,
Vultr, Linode, ...) and the server boots with Composery behind Caddy over HTTPS. It runs the
`supervisor-caddy-compose` recipe for you on first boot, so there are no SSH steps. Point DNS
at the server and set your domain in the file first.

**-> [DigitalOcean guide](../../docs/self-hosting/digitalocean.md)** ·
[Docker Compose on a VPS](../../docs/self-hosting/vps.md)
