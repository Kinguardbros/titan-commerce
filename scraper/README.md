# Titan Scraper

Standalone Amazon reviews scraper service (Puppeteer + stealth plugin) that the
Titan Commerce backend calls over HTTP with a bearer token. Lives here for
version control + disaster recovery; deployed to the VPS via rsync.

## Prerequisites

- VPS with Docker + Docker Compose v2 installed (`docker compose version`)
- SSH access to the VPS: `ssh root@37.27.189.60`
- Target directory on VPS: `/root/titan-scraper/`

## 1. Generate the bearer token

Titan Commerce backend authenticates to this scraper with a bearer token. Generate
one and keep it safe — you'll need it both on the VPS `.env` and as
`AMAZON_SCRAPER_TOKEN` on the Titan Vercel side.

```bash
openssl rand -hex 32
```

On the VPS, create `/root/titan-scraper/.env` (copy `.env.example` as a starting
point) and paste the generated token:

```bash
ssh root@37.27.189.60 'cat > /root/titan-scraper/.env' << 'EOF'
TITAN_SCRAPER_TOKEN=<paste-64-char-hex-here>
PORT=3100
EOF
ssh root@37.27.189.60 'chmod 600 /root/titan-scraper/.env'
```

## 2. Deploy (sync repo files to VPS)

From the Titan repo root, rsync this folder to the VPS, excluding local-only
files (`.env` must never be overwritten by a repo copy that doesn't have it):

```bash
rsync -avz --exclude=node_modules --exclude=.env scraper/ root@37.27.189.60:/root/titan-scraper/
```

## 3. Build + run

```bash
ssh root@37.27.189.60 'cd /root/titan-scraper && docker compose up -d --build'
```

## 4. Health check

```bash
curl http://37.27.189.60:3100/health
```

## 5. Logs

```bash
ssh root@37.27.189.60 'cd /root/titan-scraper && docker compose logs -f'
```

## 6. Rollback

```bash
ssh root@37.27.189.60 'cd /root/titan-scraper && docker compose down'
```

## 7. Token rotation

1. Update `TITAN_SCRAPER_TOKEN` in `/root/titan-scraper/.env` on the VPS.
2. Restart the service so it picks up the new value:

```bash
ssh root@37.27.189.60 'cd /root/titan-scraper && docker compose restart'
```

3. Update `AMAZON_SCRAPER_TOKEN` on the Titan Vercel side to match.

## Notes

- If `docker build` fails on a missing apt package (e.g. `libasound2`), see the
  comment at the top of `Dockerfile` — some Debian/Ubuntu base images rename
  packages (`libasound2` -> `libasound2t64`); swap the exact offending name.
- `server.js`, `parser.js`, `anonymizer.js` are added in later tasks — this
  skeleton builds the container shell only.
