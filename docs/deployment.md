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
| Live URL | https://zmanim.duckdns.org |
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
                                   (database: zmanim)
```

Caddy handles TLS (Let's Encrypt) automatically.  
Express serves both the API (`/api/*`, `/auth/*`) and the built React SPA (everything else) from the same process.

---

## Day-to-day commands

```bash
# View logs
sudo docker compose -f /opt/zmanim/docker-compose.prod.yml logs -f

# Restart server (e.g. after env change)
sudo docker compose -f /opt/zmanim/docker-compose.prod.yml restart zmanim-server

# Stop everything
sudo docker compose -f /opt/zmanim/docker-compose.prod.yml down

# Start
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

The `--build` flag rebuilds the image. If only the server code changed (no npm dependency changes), Docker layer caching makes this fast (~30–60s). Full rebuild (new deps) takes ~3–5 min.

If the Prisma schema changed, run migrations after the container is up:
```bash
sudo docker compose -f docker-compose.prod.yml exec zmanim-server npx prisma migrate deploy
```

> ⚠️ Use `migrate deploy` (not `db push`) for production — it uses the committed migration history. Run `prisma migrate dev` locally first to generate the migration file, commit it, then deploy.

---

## First-time deployment (fresh server)

### 1. Oracle Security List
Open ports 80 and 443 inbound in OCI Console:
`Networking → VCN → Security Lists → Default → Add Ingress Rules`
- Source CIDR: `0.0.0.0/0` · Protocol: TCP · Destination Port: `80`
- Source CIDR: `0.0.0.0/0` · Protocol: TCP · Destination Port: `443`

### 2. Create database
```bash
sudo docker exec finanse-postgres-1 psql -U postgres -c \
  "CREATE USER zmanim WITH PASSWORD 'STRONG_PASSWORD';"
sudo docker exec finanse-postgres-1 psql -U postgres -c \
  "CREATE DATABASE zmanim OWNER zmanim;"
sudo docker exec finanse-postgres-1 psql -U postgres -c \
  "ALTER USER zmanim CREATEDB;"
```

### 3. Clone repo
```bash
sudo git clone https://github.com/DanielBarros1/Zmanim.git /opt/zmanim
sudo chown -R ubuntu:ubuntu /opt/zmanim
```

### 4. Create env file (NOT committed to git)
`/opt/zmanim/server/.env`:
```env
NODE_ENV=production
PORT=3001
DATABASE_URL="postgresql://zmanim:STRONG_PASSWORD@finanse-postgres-1:5432/zmanim"
SESSION_SECRET="<64 random hex chars — generate with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\">"
CLIENT_URL="https://zmanim.duckdns.org"
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_CALLBACK_URL="https://zmanim.duckdns.org/auth/google/callback"
ALLOWED_EMAIL_DOMAIN=""
```

While `GOOGLE_CLIENT_ID` is empty, the dev-login bypass is active (creates `dev@zmanim.local` as ADMIN). Disable in production by filling in OAuth credentials.

### 5. Build and start
```bash
cd /opt/zmanim
sudo docker compose -f docker-compose.prod.yml up -d --build
sudo docker compose -f docker-compose.prod.yml logs -f   # watch for startup errors
```

### 6. Seed database
```bash
sudo docker compose -f docker-compose.prod.yml exec zmanim-server npx prisma db push
sudo docker compose -f docker-compose.prod.yml exec zmanim-server npx tsx src/seed.ts
```

### 7. Add Zmanim to Caddy
```bash
sudo tee -a /opt/finanse/Caddyfile <<'EOF'

# ── Zmanim ────────────────────────────────────────────────────────────
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
4. Fill in `/opt/zmanim/server/.env` on the server with `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ALLOWED_EMAIL_DOMAIN=ankori.edu`
5. `sudo docker compose -f /opt/zmanim/docker-compose.prod.yml restart zmanim-server`

---

## Memory budget (1 GB RAM)

| Process | ~MB idle |
|---|---|
| OS | 150 |
| Finance app (Docker, mostly idle/swapped) | 120 |
| PostgreSQL (shared container) | 90 |
| Caddy (Docker) | 15 |
| Zmanim server (Docker) | 160 |
| **Total** | **~535 MB** |

~420 MB free at idle. The auto-scheduler spikes ~150 MB temporarily — this is absorbed by swap (1 GB swap is pre-configured on the server). Normal operation is well within budget.
