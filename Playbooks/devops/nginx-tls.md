# Nginx reverse proxy and TLS

- **Situation:** put a Bun app behind Nginx, "HTTPS for the domain", certificate expired, uploads fail with 413, the app sees `127.0.0.1` as every client's IP, websockets drop, "limit requests at the edge".
- **Skip when:** a CDN or platform terminates TLS and routes for you and no VPS is involved.
- **Decision:** Nginx terminates TLS and proxies to Bun on `127.0.0.1`; certbot (nginx plugin, systemd timer) issues and renews; the app trusts `X-Forwarded-For` only because Bun is unreachable except through Nginx.

## Levels

| Level | Pick when |
|---|---|
| Minimum | Anything public: TLS, redirect, proxy headers, body limit |
| Standard | Production: gzip, security headers, rate limit zones, websockets, renewal checked |
| Advanced | Heavy traffic or several upstreams: brotli module, proxy cache, upstream keepalive tuning, OCSP stapling, HSTS preload |

## Rules

### Minimum — always, never cut

- Port 80 serves only the ACME challenge and a `301` to `https://$host$request_uri`.
- Use `certbot --nginx` from the snap or the Ubuntu package, never a cron copy of an old script. Renewal runs from the `certbot.timer`; confirm with `certbot renew --dry-run`.
- Bun listens on `127.0.0.1:<port>` only. A public Bun port makes `X-Forwarded-For` forgeable.
- Send the client IP with `proxy_set_header X-Real-IP $remote_addr` and `X-Forwarded-For $remote_addr` (overwrite, not `$proxy_add_x_forwarded_for`, when Nginx is the first hop, so a client cannot prepend a fake address). Behind Cloudflare use `set_real_ip_from` with its ranges and `real_ip_header CF-Connecting-IP`.
- The app reads the client IP from that header only for requests from `127.0.0.1`; rate limits and audit logs use it.
- `client_max_body_size` is set explicitly per server, sized to the largest legitimate upload (`backend/files/uploads.md`), and raised only on the upload location. Default is 1 MB.
- `server_tokens off`; `ssl_protocols TLSv1.2 TLSv1.3`.

### Standard — adds

- `gzip on` for text types (`application/json`, `text/css`, `application/javascript`, `image/svg+xml`), `gzip_min_length 1024`, level 5. Never compress images or already compressed files.
- Websockets: `proxy_http_version 1.1`, `Upgrade` and `Connection` headers through a `map`, `proxy_read_timeout 3600s` on that location only.
- Rate limit at Nginx for coarse abuse: `limit_req_zone $binary_remote_addr` on `/api/` and a tighter zone for login; `limit_req_status 429`. Fine per-user and per-key limits stay in the app (`backend/reliability/rate-limit.md`).
- `proxy_read_timeout 60s`; long reports go to a background job, not a 5-minute timeout.
- Headers: `Strict-Transport-Security` (start at `max-age=300`, raise after a week), `X-Content-Type-Options nosniff`.
- Serve user uploads from a separate location or domain, with no script execution (`security/INDEX.md`).

### Advanced — adds

- Brotli via `ngx_brotli` (dynamic module), level 5, only if the package exists for the distribution; otherwise gzip.
- `upstream` with `keepalive 32` that includes `/etc/nginx/app-live/live.inc` (written by the deploy script, one Bun port at a time; `devops/deploy-zero-downtime.md`); seed it once with `server 127.0.0.1:3000;`. `listen … ssl http2;` works on every version; from nginx 1.25.1 (Ubuntu 24.04 ships 1.24) the separate `http2 on;` directive replaces it.
- `proxy_cache` for public GET pages with `proxy_cache_lock on` and `proxy_cache_use_stale updating error timeout`.

## Edge cases

| Case | Expected behaviour |
|---|---|
| Upload of 8 MB returns `413` before reaching the app | `client_max_body_size` is the limit; the app validates its own limit too and returns the real error shape |
| Client sends a forged `X-Forwarded-For: 1.2.3.4` | Nginx overwrites it with `$remote_addr`; logs and limits see the real IP |
| Data at 100×: 100× requests per second | Rate-limit zone memory sized (`10m` holds about 160k addresses); excess gets `429` with `Retry-After`, Bun never sees it |
| Twice / parallel: certbot renewals run from two timers | One lock wins; stop duplicates by keeping a single mechanism (snap timer or apt timer, not both) |
| Renewal succeeds but Nginx still serves the old certificate | Deploy hook `systemctl reload nginx` in `/etc/letsencrypt/renewal-hooks/deploy/` |
| Mobile users behind carrier NAT share one IP | The per-IP zone is generous (`10r/s`, `burst 40 nodelay`) or it blocks a whole district |
| A websocket idle for 60 s dies | The app sends ping every 25 s; `proxy_read_timeout` raised on that location |
| Redirect loop with an app that redirects to `http://` | Send `X-Forwarded-Proto $scheme` and trust it in the app only from localhost |
| Domain's `www` and bare name | Both in the certificate; one redirects to the other with `301` |

## Example — Standard, Nginx

```nginx
limit_req_zone $binary_remote_addr zone=Api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=Login:10m rate=5r/m;

map $http_upgrade $ConnectionUpgrade {
    default upgrade;
    ""      close;
}

upstream App {
    include /etc/nginx/app-live/live.inc;
    keepalive 32;
}

server {
    listen 80;
    listen [::]:80;
    server_name example.com www.example.com;
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://example.com$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    server_tokens off;

    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types application/json text/css application/javascript image/svg+xml;

    client_max_body_size 2m;
    limit_req_status 429;

    add_header Strict-Transport-Security "max-age=300" always;
    add_header X-Content-Type-Options nosniff always;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $ConnectionUpgrade;
    proxy_read_timeout 60s;

    location /api/ {
        limit_req zone=Api burst=40 nodelay;
        proxy_pass http://App;
    }

    location = /api/auth/login {
        limit_req zone=Login burst=5 nodelay;
        proxy_pass http://App;
    }

    location /api/uploads {
        client_max_body_size 20m;
        proxy_request_buffering off;
        proxy_pass http://App;
    }

    location /ws {
        proxy_read_timeout 3600s;
        proxy_pass http://App;
    }

    location / { proxy_pass http://App; }
}
```

Other servers: Caddy does TLS and renewal by itself (`reverse_proxy 127.0.0.1:3000`) and is acceptable when the client prefers it; the IP-trust and body-limit rules stay the same.

## Verify

- [ ] `[M]` `curl -sI http://example.com` returns `301` to HTTPS; `nginx -t` passes.
- [ ] `[M]` `certbot renew --dry-run` succeeds and `systemctl list-timers` shows the certbot timer.
- [ ] `[M]` `curl -H 'X-Forwarded-For: 9.9.9.9' https://example.com/api/whoami` returns the real IP, not `9.9.9.9`.
- [ ] `[M]` A file just under the limit uploads; one just over returns `413` with a clear message.
- [ ] `[S]` `curl -H 'Accept-Encoding: gzip' -sI …/app.js` shows `content-encoding: gzip`; 30 quick requests to `/api/` produce `429`s.
- [ ] `[S]` A websocket stays open past 70 s idle.
- [ ] `[A]` Brotli answers when `Accept-Encoding: br`; stale cache served during an upstream restart.

## Pitfalls

- **`proxy_add_x_forwarded_for` as the first hop** → client-controlled IP → overwrite with `$remote_addr`.
- **Raising `client_max_body_size` server-wide to 100m** → slow-upload memory and disk abuse → raise on the upload location only.
- **`proxy_request_buffering on` for big uploads** → Nginx writes the whole body to disk first → `off` on the upload location when the app streams.
- **Certificate paths hard-coded to a staging cert** → browsers warn → run `certbot certificates` after setup.
- **Forgetting `add_header … always`** → header missing on `4xx/5xx` → add `always`.

## Related

`devops/vps-setup.md` · `devops/deploy-zero-downtime.md` · `backend/reliability/rate-limit.md` · `backend/files/uploads.md` · `Stacks/Bun-Hono.md`
