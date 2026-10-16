# Deploying Cabo Online to a VPS

This guide runs Cabo Online on a single Linux VPS with Docker Compose and
Caddy for automatic HTTPS. It assumes you are comfortable with SSH and a
shell.

## What runs

| Container | Image | Purpose | Published ports |
|-----------|-------|---------|-----------------|
| `app` | built from `Dockerfile` | Node.js server: API, WebSockets, static web client | none (only reachable from Caddy) |
| `caddy` | `caddy:2.11.7-alpine` | TLS termination, HTTP→HTTPS redirect, reverse proxy incl. WebSockets | 80/tcp, 443/tcp, 443/udp |

The only persistent data is Caddy's certificate store (Docker volumes
`caddy_data` and `caddy_config`). **Game state is never written to disk.**

## 1. Requirements

- A VPS with 1 vCPU and 1 GB RAM. Building the image on the server needs
  roughly 1 GB of free memory and 2 GB of disk.
- Docker Engine 24+ with the Compose plugin (`docker compose version`).
- A domain or subdomain you control, for example `cabo.example.com`.

## 2. DNS

Create an `A` record (and an `AAAA` record if the VPS has IPv6) for your
domain pointing at the VPS's public address. Wait until
`dig +short cabo.example.com` returns that address. Caddy can only obtain a
certificate once DNS resolves to the server.

If you use Cloudflare, start with the record set to **DNS only** (grey cloud).
See Troubleshooting before enabling the proxy.

## 3. Firewall

Open only SSH, HTTP and HTTPS:

```sh
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp   # optional, HTTP/3
sudo ufw enable
```

Port 80 must stay open: Let's Encrypt uses it for validation, and Caddy uses
it to redirect to HTTPS. The `app` container publishes no ports, so it is not
reachable from outside. Docker-published ports bypass `ufw`, which is why only
Caddy publishes any.

## 4. Get the code and configure it

```sh
git clone <your repository URL> cabo
cd cabo
cp .env.example .env
nano .env
```

Set at least:

| Variable | Example | Notes |
|----------|---------|-------|
| `DOMAIN` | `cabo.example.com` | Hostname Caddy serves and obtains a certificate for |
| `PUBLIC_ORIGIN` | `https://cabo.example.com` | The exact origin in players' browsers. Used for the WebSocket origin check, CSP and invitation links. Must match `DOMAIN`. |
| `ACME_EMAIL` | `you@yourdomain.org` | Let's Encrypt account and expiry notices. Use a real address, because `example.com` addresses are rejected. |

There are no other secrets. Guest tokens are generated at runtime and kept
only in memory.

## 5. Start

```sh
docker compose up -d --build
docker compose ps          # app should become "healthy", caddy "running"
curl -I https://cabo.example.com/healthz
```

Then open `https://cabo.example.com`. The first HTTPS request can take a few
seconds while Caddy obtains the certificate.

## 6. TLS

Caddy obtains and renews certificates automatically from Let's Encrypt and
stores them in the `caddy_data` volume. Keep that volume: deleting it forces
new certificates, and repeated re-issuing can hit Let's Encrypt rate limits.
No manual renewal or cron job is needed.

## 7. Update and restart

```sh
cd cabo
git pull
docker compose up -d --build     # rebuilds the app image and replaces the container
docker image prune -f            # optional: remove old image layers
```

To restart without changes: `docker compose restart app`.

> **Active games end on every restart or update.** All rooms, seats and
> sessions live in the server's memory. After a restart, players see "Room
> closed" and must start a new game. Deploy when nobody is playing. Reconnect
> can recover from network drops, but not from a server restart.

## 8. Logs

```sh
docker compose logs -f app       # application logs (JSON, one line per event)
docker compose logs -f caddy     # access and TLS logs
docker compose logs --since 1h app | grep '"level":50'   # errors only
```

Logs are rotated by Docker (3 × 10 MB per container). The application logs
room codes, opaque player IDs, action types and errors. It never logs session
tokens (redacted) or card values. Caddy's access log contains client IP
addresses and request paths, including room codes in invitation URLs. Treat it
as personal data under your local rules.

## 9. Health checks

| Endpoint | Meaning |
|----------|---------|
| `GET /healthz` | Process is alive (liveness) |
| `GET /readyz` | Listening and accepting traffic; returns `503` during shutdown |

The image's `HEALTHCHECK` polls `/readyz`. Caddy starts only once the app
reports healthy.

## 10. Configuration reference

All variables are optional except those in step 4. Durations are in
milliseconds.

| Variable | Default | Meaning |
|----------|---------|---------|
| `LOG_LEVEL` | `info` | `fatal` … `trace`, or `silent` |
| `RECONNECT_GRACE_MS` | `60000` | Seat reserved after a disconnect. After this, the host role can transfer and the host can hand the seat to a bot. |
| `ROOM_IDLE_TTL_MS` | `900000` | Room deleted after this long with no connected human |
| `FINISHED_ROOM_TTL_MS` | `1800000` | Finished room deleted after this long |
| `ROOM_MAX_AGE_MS` | `43200000` | Hard limit on any room's lifetime (not passed through by Compose by default) |
| `MAX_ROOMS` | `1000` | Concurrent rooms. New rooms are refused with `503` beyond this. |
| `BOT_DELAY_MIN_MS` / `BOT_DELAY_MAX_MS` | `700` / `1500` | Random pause before each bot move |
| `MAX_CONNECTIONS_PER_IP` | `30` | Concurrent WebSocket connections per client IP |
| `RATE_LIMIT_CREATE_PER_MIN` | `10` | Room creations per IP per minute |
| `RATE_LIMIT_JOIN_PER_MIN` | `30` | Join attempts per IP per minute |
| `RATE_LIMIT_LOOKUP_PER_MIN` | `60` | Room lookups per IP per minute |
| `TRUST_PROXY` | `1` (in Compose) | Proxy hops to trust for client IPs. Caddy is one hop. |

## 11. Using your own reverse proxy instead of Caddy

Remove the `caddy` service, publish the app on localhost only
(`ports: ["127.0.0.1:3000:3000"]`), and proxy to it with WebSocket upgrade
support. Example for nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;
}
```

Keep `TRUST_PROXY=1` and set `PUBLIC_ORIGIN` to the public HTTPS origin.

## 12. Troubleshooting

| Symptom | Likely cause and fix |
|---------|----------------------|
| `caddy` keeps restarting | Run `docker compose logs caddy`. A missing `DOMAIN` or `ACME_EMAIL` stops Compose with a message. A Caddyfile error shows in the log. Validate it with `docker compose run --rm --no-deps caddy caddy validate --config /etc/caddy/Caddyfile`. |
| Browser certificate error or Caddy logs `challenge failed` | DNS does not point at this server yet, or port 80/443 is blocked by a firewall or cloud security group. Fix it and run `docker compose restart caddy`. |
| Page loads, but it says "Reconnecting…" forever, or games never start | WebSocket blocked or origin mismatch. `PUBLIC_ORIGIN` must exactly equal the address bar origin (scheme and host, no trailing slash). Check with `curl -H "Origin: $PUBLIC_ORIGIN" "https://$DOMAIN/socket.io/?EIO=4&transport=polling"`, which should return text starting with `0{`. |
| Everyone gets "Too many requests" | All clients appear to come from one IP. Behind another proxy or CDN in front of Caddy, client IPs are hidden. Configure that proxy's real-IP forwarding (for Cloudflare, Caddy's `trusted_proxies`), or raise the `RATE_LIMIT_*` values. |
| "Room closed" for everyone | The server restarted (update, crash, host reboot). See section 7. |
| `app` stays `unhealthy` | `docker compose logs app`. In production, `PUBLIC_ORIGIN` is required, and the process exits with a clear message if it is missing or invalid. |
| Port 80/443 already in use | Another web server is running. Stop it, or follow section 11 and use that server as the proxy. |

## 13. Limits of this deployment

- One Node.js process holds all state. There is no horizontal scaling, no
  failover and no persistence across restarts.
- Abuse protection is basic: per-IP rate limits, connection caps, payload
  size limits, strict input validation and origin checks. There is no CAPTCHA,
  WAF or DDoS mitigation. Put a CDN or WAF in front if you expect hostile
  traffic.
