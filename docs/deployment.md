# Zmanim — Production Deployment Runbook

> Last updated: 2026-05-31

---

## Server overview

| Property | Value |
|---|---|
| Provider | Oracle Cloud Free Tier |
| Shape | VM.Standard.E2.1.Micro (1 OCPU, 1 GB RAM) |
| OS | Ubuntu 22.04 LTS |
| Region | il-jerusalem-1 |
| Public IP | 151.145.91.170 |
| Live URL | https://zmanim.duckdns.org (DuckDNS free subdomain) |
| SSH user | ubuntu |

The server also hosts the **finanse** personal finance app. Both share:
- The `finanse-caddy-1` Caddy container (owns ports 80 + 443)
- The `finanse-postgres-1` PostgreSQL container (Zmanim uses its own `zmanim` database)
- The `finanse_default` Docker bridge network

---

## Architecture

```
Internet → Oracle Security List (ports 80, 443)
         → finanse-caddy-1 (Caddy, ports 80/443)
               ├── finanse.* → finanse-server-1:4000
               └── zmanim.duckdns.org → zmanim-server-1:3001
                                              ↓
                                   finanse-postgres-1:5432
                                   (database: zmanim, user: zmanim)
```

Caddy handles TLS (Let's Encrypt) automatically for `zmanim.duckdns.org`.
Express serves both the API (`/api/*`, `/auth/*`) and the built React SPA (everything else).

**Finance app setup:** fully Dockerized (finanse-server-1, finanse-caddy-1, finanse-postgres-1).
Caddy config lives at `/opt/finanse/Caddyfile` on the host (volume-mounted into container).
Postgres superuser is `finanse` (not `postgres`) — use `-U finanse` when exec-ing psql.

---

## Day-to-day commands

```bash
# View logs
sudo docker compose -f /opt/zmanim/docker-compose.prod.yml logs -f

# Restart server (e.g. after .env change)
sudo docker compose -f /opt/zmanim/docker-compose.prod.yml restart zmanim-server

# Stop / start
sudo docker compose -f /opt/zmanim/docker-compose.prod.yml down
sudo docker compose -f /opt/zmanim/docker-compose.prod.yml up -d

# Reload Caddy config (no downtime)
sudo docker exec finanse-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

---

## Deploying an update

```bash
cd /opt/zmanim
git pull
sudo docker compose -f docker-compose.prod.yml up -d --build
```

If only server/client code changed (no new npm deps), Docker layer caching makes this fast (~60s).
If deps changed or something is wrong, force a clean rebuild:
```bash
sudo docker compose -f docker-compose.prod.yml build --no-cache
sudo docker compose -f docker-compose.prod.yml up -d
```

If the Prisma schema changed, run migrations after the container is up:
```bash
sudo docker compose -f docker-compose.prod.yml exec zmanim-server npx prisma migrate deploy
```

> ⚠️ Use `migrate deploy` (not `db push`) for production — it uses committed migration history.
> Run `prisma migrate dev` locally first to generate the migration file, commit it, then deploy.

---

## First-time deployment (fresh server)

### 1. Oracle Security List
Open ports 80 and 443 inbound in OCI Console:
`Networking → VCN → Security Lists → Default → Add Ingress Rules`
- Source CIDR: `0.0.0.0/0` · Protocol: TCP · Destination Port: `80` · Description: `HTTP - Caddy`
- Source CIDR: `0.0.0.0/0` · Protocol: TCP · Destination Port: `443` · Description: `HTTPS`

Leave Stateless toggle OFF (stateful handles return traffic automatically).

### 2. Create database
```bash
# Note: postgres superuser is 'finanse', NOT 'postgres'
# Use heredoc to avoid bash history expansion (! in passwords breaks without it)
sudo docker exec -i finanse-postgres-1 psql -U finanse <<'EOF'
CREATE USER zmanim WITH PASSWORD 'your_password';
CREATE DATABASE zmanim OWNER zmanim;
ALTER USER zmanim CREATEDB;
EOF
```

### 3. Clone repo
```bash
sudo git clone https://github.com/DanielBarros1/Zmanim.git /opt/zmanim
sudo chown -R ubuntu:ubuntu /opt/zmanim
```

### 4. Create env file (NOT committed to git)
Use a quoted heredoc to avoid bash expanding `!` or `$` in the values:
```bash
cat > /opt/zmanim/server/.env <<'EOF'
NODE_ENV=production
PORT=3001
DATABASE_URL="postgresql://zmanim:your_password@finanse-postgres-1:5432/zmanim"
SESSION_SECRET="paste_64_hex_chars_here"
CLIENT_URL="https://zmanim.duckdns.org"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_CALLBACK_URL="https://zmanim.duckdns.org/auth/google/callback"
ALLOWED_EMAIL_DOMAIN=""
EOF
```

Generate the session secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

While `GOOGLE_CLIENT_ID` is empty, the dev-login bypass is active (creates `dev@zmanim.local` as ADMIN).

### 5. Build and start
```bash
cd /opt/zmanim
sudo docker compose -f docker-compose.prod.yml up -d --build
sudo docker compose -f docker-compose.prod.yml logs -f
```

### 6. Seed database (once container shows "Zmanim server running")
```bash
sudo docker compose -f docker-compose.prod.yml exec zmanim-server npx prisma db push
sudo docker compose -f docker-compose.prod.yml exec zmanim-server npx tsx src/seed.ts
```

### 7. Add Zmanim to Caddy
```bash
sudo tee -a /opt/finanse/Caddyfile <<'EOF'

# ── Zmanim ──────────────────────────────────────────────────────────
zmanim.duckdns.org {
  reverse_proxy zmanim-server-1:3001
}
EOF

sudo docker exec finanse-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

### 8. Verify
```bash
curl https://zmanim.duckdns.org/health   # → {"status":"ok"}
```

---

## Enabling Google OAuth

1. Go to Google Cloud Console → your OAuth app
2. Add to **Authorized JavaScript origins**: `https://zmanim.duckdns.org`
3. Add to **Authorized redirect URIs**: `https://zmanim.duckdns.org/auth/google/callback`
4. Fill in `/opt/zmanim/server/.env` with real `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL_DOMAIN=ankori.edu`
5. `sudo docker compose -f /opt/zmanim/docker-compose.prod.yml restart zmanim-server`

---

## Docker build — lessons learned (hard-won)

### Prisma + Docker base image
**Problem:** `node:20-alpine` uses musl libc. Prisma 5's OpenSSL detection fails silently on Alpine
and defaults to the `linux-musl` (OpenSSL 1.1) binary even when `linux-musl-openssl-3.0.x` is
generated. Symptom: `Error loading shared library libssl.so.1.1: No such file or directory`.

**Fix:** Use `node:20-slim` (Debian Bookworm) as the base image. Install `openssl` via apt.
Use `debian-openssl-3.0.x` as the Prisma binary target (NOT `linux-openssl-3.0.x` — that's
not a valid target name; correct ones for Debian are `debian-openssl-1.0.x/1.1.x/3.0.x`).

### Prisma generate must run before tsc
**Problem:** `tsc` fails with `Module '@prisma/client' has no exported member 'Day'` and a
cascade of TS7006 implicit-any errors in Prisma query callbacks. Root cause: `@prisma/client`
has no types until `prisma generate` has been run.

**Fix:** Run `cd server && npx prisma generate` as a Dockerfile step BEFORE `npm run build --workspace=server`.

### Layer caching hides fixes
**Problem:** `docker compose up -d --build` uses layer caching. If `COPY . .` is cached, a
`prisma generate` step won't re-run even if schema.prisma changed.

**Fix:** `sudo docker compose -f docker-compose.prod.yml build --no-cache` for any Prisma-related changes.

### Bash history expansion in shell
**Problem:** `!` in passwords or `!@hostname` in DATABASE_URL triggers bash history expansion
(`event not found` error). Single-quoted heredocs (`<<'EOF'`) prevent ALL bash expansion.
Also: postgres superuser in the finanse container is `finanse`, not `postgres`.

### Client TypeScript errors blocked Docker build
The server's `tsc -b && vite build` (client build script) enforces TypeScript strictly.
Several pre-existing errors that the Vite dev server ignored became blockers:
- `AutoSchedulerModal.tsx`: unused `deleteSchedule` variable
- `ImportPage.tsx`: `Record<LessonType, string>` missing `PARALLEL` and `MULTI_TEACHER`
- `RestrictionsPage.tsx`: `Record<RestrictionTier, ...>` missing `INVARIANT`
- `GradeViewPage.tsx`: null used as index type
- `shared/entities.ts`: `AuthUser` missing `picture` field (added to server but not shared type)
- `shared/dist/` stale locally — rebuild with `npm run build --workspace=shared` when shared source changes

---

## Memory budget (1 GB RAM)

| Process | ~MB idle |
|---|---|
| OS | 150 |
| Finance app (Docker, mostly swapped when idle) | 120 |
| PostgreSQL (shared container) | 90 |
| Caddy (Docker) | 15 |
| Zmanim server (Docker) | 160 |
| **Total** | **~535 MB** |

~420 MB free at idle. The auto-scheduler spikes ~150 MB temporarily — absorbed by swap
(1 GB swap pre-configured). Normal operation is well within budget.
