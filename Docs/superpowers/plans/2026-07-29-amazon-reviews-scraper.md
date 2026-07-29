# Amazon Reviews Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrape Amazon product reviews via TC scraper VPS, preview them in admin dashboard, selectively import as pending reviews in Titan, then use existing `push_reviews_to_shopify` pipeline to push to Isola storefront metafields.

**Architecture:** Two services. (1) TC scraper VPS (37.27.189.60, Docker + Express + Puppeteer + stealth plugin) — dedicated HTTP endpoint with bearer token auth. (2) Titan Commerce Vercel — new `reviews-amazon.js` actions dispatched via `api/system.js` router; downloads photos + inserts to Supabase per existing pattern. Frontend: `AmazonImport` component + 4th tab in `ImportReviews.jsx`.

**Tech Stack:** VPS side: Node 20 Docker + puppeteer v24 + puppeteer-extra + stealth-plugin + express. Titan side: existing React 19 + Vite + Vercel + Supabase.

## Global Constraints

- **Vercel Hobby 12/12 routes** — NO new `api/*.js` files, all new actions via `api/system.js`
- **Vercel timeout 60s** — actions use `AbortSignal.timeout(55000)` when calling external services
- **Scrape MAX 10 reviews per request** (locked D-12) — sync flow, no job queue
- **`catch (e) {}` FORBIDDEN** — always console.error + rethrow or graceful response
- Password hashing on scraper side = N/A (bearer token only, secret in env)
- Bearer token pattern: `crypto.timingSafeEqual` with length pre-check (RangeError on mismatch throws otherwise — a timing leak)
- `--legacy-peer-deps` for Titan npm install (Higgsfield peer conflict); scraper side (separate repo, own `package.json`) has no such rule
- Files ≤ 300 lines
- Language: UI text = English; code + comments = English; Docs = Czech
- `pipeline_log` agent = `AMAZON_SCRAPER`
- Rate limits (via `lib/rate-limit.js`): `amazon_scrape:{user_id}` 10/hour (Titan side) + `express-rate-limit` 10/min per IP + 20/hour global (scraper VPS side)
- **Alethe VPS 147.93.56.72 = NEVER touch** (absolute rule per Dan) — all VPS tasks in this plan target `37.27.189.60` only
- Amazon page structure watchdog: log `reviewCard` selector 0-match with sample HTML (first 500 chars) — canary for DOM refresh
- Auth pattern (Titan side, per feature-02 baseline): every new action starts with `hasPermission(req.user, 'products:edit')` → 403, then `hasStoreAccess(req.user, store_id)` → 403
- Body cap: review `body` truncated to 2000 chars (existing Titan cap, matches `product_reviews.body` convention)
- Feature flag: `process.env.FEATURE_AMAZON_REVIEWS_SCRAPER` (env-var, default off) — gates the Amazon tab in UI and 503s the 2 backend actions when off

---

## File Structure

**Create (Titan git repo):**
- `sql/add-review-amazon-source.sql`
- `lib/actions/reviews-amazon.js` — `scrape_amazon_preview`, `import_amazon_reviews`
- `apps/dashboard/src/components/AmazonImport.jsx` (+ `.css`)
- `tests/reviews-shared.test.js`
- `tests/reviews-amazon.test.js`

**Create (TC scraper VPS, `/root/titan-scraper/` — NOT in Titan git repo):**
- `package.json`, `Dockerfile`, `docker-compose.yml`, `.env` (secret, not committed anywhere)
- `server.js`, `parser.js`, `anonymizer.js`
- `scripts/.env.example` (in Titan git repo, documents the scraper's env shape for ops reference)

**Modify (Titan git repo):**
- `lib/actions/reviews-shared.js` — extract `validateImageBuffer(buf, maxBytes)` from `decodeAndValidateImage`
- `api/system.js` — register 2 new POST actions
- `apps/dashboard/src/components/ImportReviews.jsx` — refactor to real tabs, add 4th "Amazon" tab
- `apps/dashboard/src/lib/api.js` — add `scrapeAmazonPreview` + `importAmazonReviews` wrappers
- `CLAUDE.md` — document `reviews-amazon.js`, `source='amazon'`, TC scraper VPS dependency
- `features/active/03-amazon-reviews-scraper.md` → moved to `features/shipped/`

---

### Task 1: VPS prep — swapfile + ex-Yomi cleanup

**Files:** none (VPS-side infra, no repo changes)

**Interfaces:**
- Consumes: nothing (foundation task)
- Produces: `/root/titan-scraper/` directory ready on 37.27.189.60; 2 GB swap active; ex-Yomi Docker artifacts removed

- [ ] **Manual step 1: SSH into the VPS**

```bash
ssh -i ~/.ssh/id_ed25519 root@37.27.189.60
```

- [ ] **Manual step 2: Inventory + remove ex-Yomi Docker leftovers**

```bash
docker ps -a
docker images
docker system prune -af
```

Expected: `docker ps -a` shows old Yomi containers (stopped) before prune; `docker system prune -af` reports reclaimed space; `docker ps -a` after is empty or near-empty.

- [ ] **Manual step 3: Create 2 GB swapfile (RAM is 3.7 GB, no swap — Chromium OOM risk)**

```bash
free -h
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
swapon --show
```

Expected: `swapon --show` lists `/swapfile` with size `2G`. `free -h` now shows `Swap: 2.0Gi`.

- [ ] **Manual step 4: Create deploy directory**

```bash
mkdir -p /root/titan-scraper
ls -la /root/titan-scraper
```

Expected: empty directory exists, owned by root.

- [ ] **Manual step 5: Verify Ubuntu version + Docker present**

```bash
lsb_release -a
docker --version
docker compose version || docker-compose --version
```

Expected: Ubuntu 22.04.5 LTS, Docker present, compose plugin or standalone `docker-compose` present.

No commit — this task has no repo changes.

---

### Task 2: Scraper skeleton — package.json + Dockerfile + docker-compose.yml

**Files:**
- Create (on VPS, `/root/titan-scraper/`): `package.json`, `Dockerfile`, `docker-compose.yml`, `.env` (VPS-only, never committed)
- Create (Titan git repo): `scripts/.env.example`

**Interfaces:**
- Consumes: nothing (Task 1 provides the directory)
- Produces: buildable Docker image skeleton; `TITAN_SCRAPER_TOKEN` env var contract documented for later tasks

- [ ] **Manual step 1: Write `package.json` on the VPS**

SSH in (`ssh -i ~/.ssh/id_ed25519 root@37.27.189.60`), then create `/root/titan-scraper/package.json`:

```json
{
  "name": "titan-scraper",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "puppeteer": "^24.10.0",
    "puppeteer-extra": "^3.3.6",
    "puppeteer-extra-plugin-stealth": "^2.11.2",
    "express": "^4.19.2",
    "express-rate-limit": "^7.4.0",
    "dotenv": "^16.4.5"
  }
}
```

- [ ] **Manual step 2: Write `Dockerfile`**

Create `/root/titan-scraper/Dockerfile`:

```dockerfile
FROM node:20-slim

# Chromium runtime deps — Puppeteer's bundled Chromium needs these system libs,
# they are NOT included by `npm install puppeteer`.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
    libc6 libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
    libgcc1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
    libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
    libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 \
    libxss1 libxtst6 lsb-release wget xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Puppeteer downloads Chromium into node_modules/.cache/puppeteer during `npm install`
# above; the docker-compose volume mount persists it across container recreates.

EXPOSE 3100

CMD ["node", "server.js"]
```

- [ ] **Manual step 3: Write `docker-compose.yml`**

Create `/root/titan-scraper/docker-compose.yml`:

```yaml
services:
  titan-scraper:
    build: .
    container_name: titan-scraper
    restart: unless-stopped
    ports:
      - "3100:3100"
    env_file:
      - .env
    mem_limit: 1g
    volumes:
      - puppeteer-cache:/app/node_modules/.cache/puppeteer

volumes:
  puppeteer-cache:
```

- [ ] **Manual step 4: Generate the bearer token + write `.env` on the VPS**

Still on the VPS:

```bash
openssl rand -hex 32
```

Copy the output (64 hex chars, 256 bits — well over the 32-char minimum enforced in Task 3's server code). Create `/root/titan-scraper/.env`:

```bash
cat > /root/titan-scraper/.env << 'EOF'
TITAN_SCRAPER_TOKEN=<paste the openssl output here>
PORT=3100
EOF
chmod 600 /root/titan-scraper/.env
```

Expected: `.env` exists, mode `600`, contains a 64-char hex token. Save the same token value locally (scratchpad) — Task 10 needs to set it as `AMAZON_SCRAPER_TOKEN` on the Titan Vercel side.

- [ ] **Step 5: Document the env shape in the Titan git repo**

Create `scripts/.env.example` in the Titan repo (local machine, not the VPS):

```bash
# TC scraper VPS (/root/titan-scraper/.env) — template only, real values live on the VPS.
# Generate the token with: openssl rand -hex 32
TITAN_SCRAPER_TOKEN=<64-char-hex-generated-with-openssl-rand-hex-32>
PORT=3100
```

- [ ] **Step 6: Validate the Docker Compose YAML locally**

On the VPS (compose config validates without needing `server.js` to exist yet — Task 3 adds it):

```bash
cd /root/titan-scraper && docker compose config > /dev/null && echo "compose OK"
```

Expected: `compose OK` (no YAML syntax errors). Build will fail at this point (no `server.js` yet) — that's expected, deferred to Task 11.

- [ ] **Step 7: Commit the Titan-repo-side template**

```bash
git add scripts/.env.example
git commit -m "feat(amazon-scraper): document TC scraper VPS env template"
```

---

### Task 3: Express server + bearer auth + health endpoint

**Files:**
- Create (VPS): `/root/titan-scraper/server.js`

**Interfaces:**
- Consumes: `process.env.TITAN_SCRAPER_TOKEN` (Task 2's `.env`)
- Produces: `GET /health → {ok: true, version}`, `POST /scrape-amazon` route registered (implementation body added in Task 4) protected by `requireBearer` middleware

- [ ] **Manual step 1: Write `server.js` skeleton with health + auth wiring**

Create `/root/titan-scraper/server.js` on the VPS:

```javascript
import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { scrapeAmazonReviews } from './parser.js';

const PORT = process.env.PORT || 3100;
const VERSION = '1.0.0';

const EXPECTED_TOKEN = process.env.TITAN_SCRAPER_TOKEN;
if (!EXPECTED_TOKEN || EXPECTED_TOKEN.length < 32) {
  throw new Error('TITAN_SCRAPER_TOKEN missing or too short (min 32 chars)');
}
const EXPECTED_BUF = Buffer.from(EXPECTED_TOKEN);

function requireBearer(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing bearer token' });
  }
  const provided = auth.slice(7);
  const providedBuf = Buffer.from(provided);
  // Length check MUST precede timingSafeEqual (which throws RangeError on length
  // mismatch — a timing leak if we caught-and-ignored that instead).
  if (providedBuf.length !== EXPECTED_BUF.length) {
    return res.status(401).json({ error: 'invalid token' });
  }
  if (!crypto.timingSafeEqual(providedBuf, EXPECTED_BUF)) {
    return res.status(401).json({ error: 'invalid token' });
  }
  next();
}

const app = express();
app.use(express.json({ limit: '1mb' }));

// Ops-level circuit breaker independent of Amazon's own throttling.
const perIpLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });
const globalLimiter = rateLimit({
  windowMs: 3_600_000, max: 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: () => 'global',
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, version: VERSION });
});

app.post('/scrape-amazon', requireBearer, perIpLimiter, globalLimiter, async (req, res) => {
  const { amazon_url, max_reviews } = req.body || {};
  if (!amazon_url || typeof amazon_url !== 'string') {
    return res.status(400).json({ error: 'amazon_url required' });
  }
  const cappedMax = Math.min(Math.max(1, parseInt(max_reviews, 10) || 10), 10);

  try {
    const result = await scrapeAmazonReviews(amazon_url, cappedMax);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[scrape-amazon] failed:', { amazon_url, error: err.message });
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'scrape failed' });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[titan-scraper] listening on 0.0.0.0:${PORT}`);
});
```

- [ ] **Manual step 2: Verify syntax (Node's built-in checker, no deps needed)**

```bash
cd /root/titan-scraper && node --check server.js
```

Expected: exits 0, no output. (Will fail with `Cannot find module './parser.js'` if actually run — that's expected, `parser.js` is Task 4. `--check` only validates syntax, not module resolution, so this passes.)

No commit — VPS-side file, not in Titan git repo.

---

### Task 4: Puppeteer scraper core (parser.js + anonymizer.js)

**Files:**
- Create (VPS): `/root/titan-scraper/parser.js`, `/root/titan-scraper/anonymizer.js`

**Interfaces:**
- Consumes: `puppeteer-extra` + stealth plugin (Task 2 deps)
- Produces: `scrapeAmazonReviews(amazonUrl, maxReviews) → Promise<{reviews: Review[], product: {asin, title}}>` where `Review = {author, rating, title, body, verified, photo_urls, helpful_count, review_date}`. Consumed by `server.js` (Task 3) and, indirectly, by Titan's `scrape_amazon_preview` (Task 7) via HTTP.
- `anonymizeAuthor(fullName) → string` — also independently reused server-side is NOT needed (Titan re-implements its own copy per D-07 audit trail simplicity, see Task 7), but scraper-side anonymization runs first as defense-in-depth so raw full names never leave the VPS.

- [ ] **Manual step 1: Write `anonymizer.js`**

Create `/root/titan-scraper/anonymizer.js`:

```javascript
// "John Smith" -> "John S." ; single-token / emoji-only / empty -> "Anonymous".
// Mirrors the Titan-side copy in lib/actions/reviews-amazon.js (D-07) — this VPS-side
// copy runs first so raw full names never leave the scraper.
export function anonymizeAuthor(fullName) {
  if (!fullName || typeof fullName !== 'string') return 'Anonymous';
  const trimmed = fullName.trim();
  if (!trimmed) return 'Anonymous';
  if (trimmed.length === 1 || !/[a-zA-Z]/.test(trimmed)) return 'Anonymous';
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  const lastInitial = parts.length > 1 ? parts[parts.length - 1][0]?.toUpperCase() : '';
  return lastInitial ? `${first} ${lastInitial}.` : first;
}
```

- [ ] **Manual step 2: Write `parser.js`**

Create `/root/titan-scraper/parser.js`:

```javascript
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { anonymizeAuthor } from './anonymizer.js';

puppeteer.use(StealthPlugin());

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const SELECTORS = {
  reviewCard: 'div[data-hook="review"]',
  starRating: 'i[data-hook="review-star-rating"] span.a-icon-alt',
  author: 'span.a-profile-name',
  reviewTitle: 'a[data-hook="review-title"] span:not([class*="a-color-secondary"])',
  reviewBody: 'span[data-hook="review-body"] span',
  verifiedBadge: 'span[data-hook="avp-badge"]',
  photos: 'div[data-hook="review-image-tile-section"] img',
  helpfulText: 'span[data-hook="helpful-vote-statement"]',
  reviewDate: 'span[data-hook="review-date"]',
  nextPageLink: 'ul.a-pagination li.a-last a',
};

function extractAsin(amazonUrl) {
  const m = String(amazonUrl).match(/\/(?:dp|product-reviews|gp\/product)\/([A-Z0-9]{10})/i);
  if (!m) {
    const err = new Error('Could not extract ASIN from Amazon URL — check the URL format (expects /dp/{ASIN} or /product-reviews/{ASIN})');
    err.status = 400;
    throw err;
  }
  return m[1].toUpperCase();
}

function reviewsUrl(asin, pageNumber) {
  return `https://www.amazon.com/product-reviews/${asin}/?pageNumber=${pageNumber}&sortBy=recent`;
}

function parseRating(text) {
  // "5.0 out of 5 stars" (US) or "5,0 von 5 Sternen" (DE-style comma decimal)
  const first = String(text || '').trim().split(' ')[0].replace(',', '.');
  const n = parseFloat(first);
  return Number.isFinite(n) ? n : null;
}

function parseHelpfulCount(text) {
  const s = String(text || '').trim();
  if (!s) return 0;
  if (/^one person found this helpful/i.test(s)) return 1;
  const m = s.match(/(\d[\d,]*)/);
  return m ? parseInt(m[1].replace(/,/g, ''), 10) : 0;
}

function upgradePhotoUrl(url) {
  // Amazon thumb "._SY88_.jpg" -> high-res "._SL1600_.jpg"
  return url.replace(/\._[A-Z]{2}\d+_?\./, '._SL1600_.');
}

async function detectCloudflareBlock(page) {
  const title = await page.title().catch(() => '');
  return /sorry! something went wrong/i.test(title);
}

async function extractReviewsFromPage(page) {
  return page.evaluate((sel) => {
    const cards = Array.from(document.querySelectorAll(sel.reviewCard));
    return cards.map((card) => {
      const starEl = card.querySelector(sel.starRating);
      const authorEl = card.querySelector(sel.author);
      const titleEl = card.querySelector(sel.reviewTitle);
      const bodyEl = card.querySelector(sel.reviewBody);
      const verifiedEl = card.querySelector(sel.verifiedBadge);
      const helpfulEl = card.querySelector(sel.helpfulText);
      const dateEl = card.querySelector(sel.reviewDate);
      const photoEls = Array.from(card.querySelectorAll(sel.photos));
      return {
        rawAuthor: authorEl?.textContent?.trim() || '',
        rawRating: starEl?.textContent?.trim() || '',
        title: titleEl?.textContent?.trim() || '',
        body: bodyEl?.textContent?.trim() || '',
        verified: !!verifiedEl,
        rawHelpful: helpfulEl?.textContent?.trim() || '',
        rawDate: dateEl?.textContent?.trim() || '',
        photoSrcs: photoEls.map((img) => img.getAttribute('src')).filter(Boolean),
      };
    });
  }, SELECTORS);
}

/**
 * @param {string} amazonUrl
 * @param {number} maxReviews - capped to 10 by the caller (server.js)
 * @returns {Promise<{reviews: object[], product: {asin: string, title: string}}>}
 */
export async function scrapeAmazonReviews(amazonUrl, maxReviews) {
  const asin = extractAsin(amazonUrl);
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1366, height: 900 });

    const collected = [];
    let pageNumber = 1;
    let productTitle = null;
    let retriedBlock = false;

    while (collected.length < maxReviews && pageNumber <= 10) {
      await page.goto(reviewsUrl(asin, pageNumber), { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Randomized human-like dwell before reading the DOM.
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));

      if (await detectCloudflareBlock(page)) {
        if (retriedBlock) {
          const err = new Error('Amazon blocked the scraper (Cloudflare challenge) after 1 retry');
          err.status = 503;
          throw err;
        }
        console.warn('[parser] Cloudflare block detected, retrying once after 30s', { asin, pageNumber });
        retriedBlock = true;
        await new Promise((r) => setTimeout(r, 30000));
        continue; // retry same page, do not advance pageNumber
      }

      if (!productTitle) {
        productTitle = await page.title().catch(() => null);
      }

      const rawReviews = await extractReviewsFromPage(page);
      if (rawReviews.length === 0 && pageNumber === 1) {
        // Canary: selector 0-match on page 1 — either no reviews exist or Amazon's DOM
        // structure changed. Log a sample of the HTML for diagnosis.
        const sample = await page.content().then((h) => h.slice(0, 500)).catch(() => '');
        console.warn('[parser] reviewCard selector 0 matches on page 1 — DOM refresh canary', { asin, sample });
      }
      if (rawReviews.length === 0) break; // no more reviews on later pages

      for (const raw of rawReviews) {
        if (collected.length >= maxReviews) break;
        const rating = parseRating(raw.rawRating);
        if (rating === null) {
          console.warn('[parser] skipping review with unparseable rating', { asin, author: raw.rawAuthor });
          continue;
        }
        collected.push({
          author: anonymizeAuthor(raw.rawAuthor),
          rating,
          title: raw.title,
          body: raw.body.slice(0, 2000),
          verified: raw.verified,
          photo_urls: raw.photoSrcs.slice(0, 1).map(upgradePhotoUrl), // first photo only (no-go: multi-photo)
          helpful_count: parseHelpfulCount(raw.rawHelpful),
          review_date: raw.rawDate,
        });
      }

      const hasNext = await page.$(SELECTORS.nextPageLink).then((el) => !!el);
      if (!hasNext) break;
      pageNumber += 1;
    }

    return {
      reviews: collected,
      product: { asin, title: productTitle || asin },
    };
  } finally {
    await browser.close();
  }
}
```

- [ ] **Manual step 3: Build + start the container, verify server boots**

```bash
cd /root/titan-scraper
docker compose build
docker compose up -d
docker compose logs --tail=20 titan-scraper
```

Expected log line: `[titan-scraper] listening on 0.0.0.0:3100`.

- [ ] **Manual step 4: Local health check**

```bash
curl -s http://localhost:3100/health
```

Expected: `{"ok":true,"version":"1.0.0"}`

- [ ] **Manual step 5: Real-Amazon smoke test**

```bash
source /root/titan-scraper/.env
curl -s -X POST http://localhost:3100/scrape-amazon \
  -H "Authorization: Bearer $TITAN_SCRAPER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amazon_url":"https://www.amazon.com/dp/B08N5WRWNW","max_reviews":5}' | head -c 2000
```

Expected: JSON body with `reviews` array (up to 5 items, each with `author` in "First L." form, `rating` 1-5, `title`, `body`, `verified` boolean, `photo_urls` array, `helpful_count` number, `review_date` string) and `product: {asin, title}`. If Amazon blocks (Cloudflare), expect a `503` with `"Amazon blocked the scraper..."` — retry later or with a different ASIN before proceeding.

No commit — VPS-side files, not in Titan git repo.

---

### Task 5: Rate limits + error handling hardening

**Files:**
- Modify (VPS): `/root/titan-scraper/server.js` (already has rate-limit middleware from Task 3 — this task verifies it end-to-end and tightens 429/503 response shape)

**Interfaces:**
- Consumes: `express-rate-limit` middleware wired in Task 3
- Produces: verified 429 behavior; Amazon 429 passthrough as 503 to caller with `retryAfter`

- [ ] **Manual step 1: Update `scrapeAmazonReviews` to detect Amazon's own 429 and surface `retryAfter`**

Edit `/root/titan-scraper/parser.js`. In the page-load loop, after `await page.goto(...)`, add an Amazon-429 check right after the Cloudflare-block check:

```javascript
      const httpStatus = page.mainFrame ? null : null; // placeholder removed below
```

Replace that placeholder — instead, extend the `page.goto` call to capture the response and check its status. Find:

```javascript
      await page.goto(reviewsUrl(asin, pageNumber), { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Randomized human-like dwell before reading the DOM.
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
```

Replace with:

```javascript
      const navResponse = await page.goto(reviewsUrl(asin, pageNumber), { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (navResponse && navResponse.status() === 429) {
        const err = new Error('Amazon rate-limited this request (429) — wait 5 minutes and try again');
        err.status = 503;
        err.retryAfter = 300;
        throw err;
      }
      // Randomized human-like dwell before reading the DOM.
      await new Promise((r) => setTimeout(r, 2000 + Math.random() * 3000));
```

- [ ] **Manual step 2: Surface `retryAfter` in the server's error response**

Edit `/root/titan-scraper/server.js`. Find the `scrape-amazon` catch block:

```javascript
  } catch (err) {
    console.error('[scrape-amazon] failed:', { amazon_url, error: err.message });
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'scrape failed' });
  }
```

Replace with:

```javascript
  } catch (err) {
    console.error('[scrape-amazon] failed:', { amazon_url, error: err.message });
    const status = err.status || 500;
    const body = { error: err.message || 'scrape failed' };
    if (err.retryAfter) body.retryAfter = err.retryAfter;
    return res.status(status).json(body);
  }
```

- [ ] **Manual step 3: Rebuild + restart**

```bash
cd /root/titan-scraper
docker compose up -d --build
docker compose logs --tail=10 titan-scraper
```

Expected: `[titan-scraper] listening on 0.0.0.0:3100` with no startup errors.

- [ ] **Manual step 4: Verify per-IP rate limit trips at 11th request/min**

```bash
source /root/titan-scraper/.env
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3100/scrape-amazon \
    -H "Authorization: Bearer $TITAN_SCRAPER_TOKEN" -H "Content-Type: application/json" \
    -d '{"amazon_url":"https://www.amazon.com/dp/B08N5WRWNW","max_reviews":1}'
done
```

Expected: first 10 lines show `200` (or `503` if Amazon itself blocks — acceptable, still means the request reached the handler), the 11th line shows `429`.

No commit — VPS-side files, not in Titan git repo.

---

### Task 6: SQL migration + `reviews-shared.js` refactor

**Files:**
- Create: `sql/add-review-amazon-source.sql`
- Modify: `lib/actions/reviews-shared.js`
- Test: `tests/reviews-shared.test.js`

**Interfaces:**
- Consumes: nothing (foundation task on Titan side)
- Produces:
  - `product_reviews.source` CHECK now includes `'amazon'`
  - `validateImageBuffer(buf, maxBytes) → {buf, ext, contentType} | {error}` — new export from `reviews-shared.js`
  - `decodeAndValidateImage(base64, maxBytes)` — unchanged signature/behavior, now implemented by decoding then delegating to `validateImageBuffer`

- [ ] **Step 1: Write the failing test**

Create `tests/reviews-shared.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { validateImageBuffer, decodeAndValidateImage } from '../lib/actions/reviews-shared.js';

// Minimal valid magic-byte headers for each format (bodies are junk — only the
// header bytes are checked by validateImageBuffer).
const JPEG_HEADER = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]);
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
function webpBuffer() {
  const buf = Buffer.alloc(16);
  buf.write('RIFF', 0, 'ascii');
  buf.write('WEBP', 8, 'ascii');
  return buf;
}

describe('validateImageBuffer', () => {
  it('accepts a JPEG buffer', () => {
    const result = validateImageBuffer(JPEG_HEADER, 1024 * 1024);
    expect(result.error).toBeUndefined();
    expect(result.ext).toBe('jpg');
    expect(result.contentType).toBe('image/jpeg');
    expect(result.buf).toBe(JPEG_HEADER);
  });

  it('accepts a PNG buffer', () => {
    const result = validateImageBuffer(PNG_HEADER, 1024 * 1024);
    expect(result.error).toBeUndefined();
    expect(result.ext).toBe('png');
    expect(result.contentType).toBe('image/png');
  });

  it('accepts a WebP buffer', () => {
    const result = validateImageBuffer(webpBuffer(), 1024 * 1024);
    expect(result.error).toBeUndefined();
    expect(result.ext).toBe('webp');
    expect(result.contentType).toBe('image/webp');
  });

  it('rejects an empty buffer', () => {
    const result = validateImageBuffer(Buffer.alloc(0), 1024);
    expect(result.error).toBe('empty image');
  });

  it('rejects a buffer over the size cap', () => {
    const big = Buffer.concat([JPEG_HEADER, Buffer.alloc(2 * 1024 * 1024)]);
    const result = validateImageBuffer(big, 1024 * 1024);
    expect(result.error).toMatch(/too large/);
  });

  it('rejects a buffer with unrecognized magic bytes', () => {
    const junk = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    const result = validateImageBuffer(junk, 1024 * 1024);
    expect(result.error).toBe('file is not a JPEG/PNG/WebP image');
  });
});

describe('decodeAndValidateImage — delegates to validateImageBuffer', () => {
  it('decodes base64 then validates a JPEG', () => {
    const b64 = JPEG_HEADER.toString('base64');
    const result = decodeAndValidateImage(b64, 1024 * 1024);
    expect(result.error).toBeUndefined();
    expect(result.ext).toBe('jpg');
  });

  it('rejects malformed base64 that decodes to empty', () => {
    const result = decodeAndValidateImage('', 1024 * 1024);
    expect(result.error).toBe('empty image');
  });

  it('rejects base64 decoding to junk magic bytes', () => {
    const junk = Buffer.from([0x00, 0x01, 0x02, 0x03]).toString('base64');
    const result = decodeAndValidateImage(junk, 1024 * 1024);
    expect(result.error).toBe('file is not a JPEG/PNG/WebP image');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/reviews-shared.test.js`

Expected: FAIL — `validateImageBuffer is not a function` (not exported yet).

- [ ] **Step 3: Refactor `lib/actions/reviews-shared.js`**

Find the existing function:

```javascript
// Decode a base64 image and validate it by magic bytes (JPEG/PNG/WebP) + size.
// Returns { buf, ext, contentType } on success, or { error } with a safe message.
export function decodeAndValidateImage(base64, maxBytes) {
  const buf = Buffer.from(base64 || '', 'base64');
  if (!buf.length) return { error: 'empty image' };
  if (buf.length > maxBytes) return { error: `image too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)` };
  const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
  const isWebp = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) return { error: 'file is not a JPEG/PNG/WebP image' };
  const ext = isPng ? 'png' : isWebp ? 'webp' : 'jpg';
  const contentType = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';
  return { buf, ext, contentType };
}
```

Replace with:

```javascript
// Validate an already-decoded image buffer by magic bytes (JPEG/PNG/WebP) + size.
// Returns { buf, ext, contentType } on success, or { error } with a safe message.
// Used directly by callers that already have a Buffer (e.g. Amazon photo download
// via fetch()), and indirectly by decodeAndValidateImage (base64 → Buffer callers).
export function validateImageBuffer(buf, maxBytes) {
  if (!buf || !buf.length) return { error: 'empty image' };
  if (buf.length > maxBytes) return { error: `image too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)` };
  const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
  const isWebp = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isPng && !isWebp) return { error: 'file is not a JPEG/PNG/WebP image' };
  const ext = isPng ? 'png' : isWebp ? 'webp' : 'jpg';
  const contentType = isPng ? 'image/png' : isWebp ? 'image/webp' : 'image/jpeg';
  return { buf, ext, contentType };
}

// Decode a base64 image and validate it by magic bytes (JPEG/PNG/WebP) + size.
// Returns { buf, ext, contentType } on success, or { error } with a safe message.
export function decodeAndValidateImage(base64, maxBytes) {
  const buf = Buffer.from(base64 || '', 'base64');
  return validateImageBuffer(buf, maxBytes);
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/reviews-shared.test.js`

Expected: PASS (9/9).

- [ ] **Step 5: Write the SQL migration**

Create `sql/add-review-amazon-source.sql`:

```sql
-- Add 'amazon' to product_reviews.source CHECK constraint (2026-07-29)
-- Extends existing CHECK from ('manual','csv','ai','web') to include 'amazon'.
-- Run in Supabase SQL Editor. No BEGIN/COMMIT — editor runs single statements.

ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS chk_product_reviews_source;
ALTER TABLE product_reviews ADD  CONSTRAINT chk_product_reviews_source
  CHECK (source IN ('manual', 'csv', 'ai', 'web', 'amazon'));
```

- [ ] **Step 6: Verify SQL migration is well-formed**

Run: `grep -c 'ALTER TABLE product_reviews' sql/add-review-amazon-source.sql`

Expected output: `2`

(SQL must be applied against the live Supabase project as a manual step in Task 12 — no code execution here.)

- [ ] **Step 7: Run full suite — no regressions**

Run: `npm test`

Expected: all pre-existing tests pass + 9 new `reviews-shared` tests.

- [ ] **Step 8: Commit**

```bash
git add sql/add-review-amazon-source.sql lib/actions/reviews-shared.js tests/reviews-shared.test.js
git commit -m "feat(amazon): extend source CHECK constraint + extract validateImageBuffer helper"
```

---

### Task 7: `lib/actions/reviews-amazon.js` (backend actions)

**Files:**
- Create: `lib/actions/reviews-amazon.js`
- Modify: `api/system.js`
- Test: `tests/reviews-amazon.test.js`

**Interfaces:**
- Consumes:
  - `hasPermission(user, perm)` / `hasStoreAccess(user, storeId)` from `lib/permissions.js`
  - `getStore(store_id)` from `lib/store-context.js`
  - `rateLimit(key, max, windowMs)` from `lib/rate-limit.js`
  - `validateImageBuffer(buf, maxBytes)` from `lib/actions/reviews-shared.js` (Task 6)
  - `uploadReviewImage(storeName, productId, buf, ext, contentType)` from `lib/actions/reviews-shared.js` (existing, unchanged)
  - `dropExistingDuplicates(db, storeId, productId, rows)` from `lib/actions/reviews-shared.js` (existing, unchanged)
  - `supabase` (service-role client) from `lib/actions/reviews-shared.js` (existing export)
  - `process.env.AMAZON_SCRAPER_URL`, `process.env.AMAZON_SCRAPER_TOKEN`, `process.env.FEATURE_AMAZON_REVIEWS_SCRAPER` (env vars, set in Task 10/12)
- Produces:
  - POST action `scrape_amazon_preview` — body `{store_id, product_id, amazon_url, max_reviews}` → `200 {reviews: [...], product: {asin, title}}` (NO DB write)
  - POST action `import_amazon_reviews` — body `{store_id, product_id, reviews: [{...}]}` → `200 {inserted: number, skipped: number, duplicates: number}`

- [ ] **Step 1: Write the failing test**

Create `tests/reviews-amazon.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const supabaseState = { logged: [], inserted: [], existing: [] };

const supabaseFromMock = vi.fn((table) => {
  if (table === 'pipeline_log') {
    return { insert: vi.fn(async (row) => { supabaseState.logged.push(row); return { error: null }; }) };
  }
  if (table === 'product_reviews') {
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: supabaseState.existing, error: null })),
        })),
      })),
      insert: vi.fn(async (rows) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        supabaseState.inserted.push(...arr);
        return { error: null };
      }),
    };
  }
  return { insert: vi.fn(async () => ({ error: null })) };
});

const storageUploadMock = vi.fn().mockResolvedValue({ error: null });
const storageGetPublicUrlMock = vi.fn().mockReturnValue({ data: { publicUrl: 'https://storage.test/photo.jpg' } });

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: supabaseFromMock,
    storage: { from: () => ({ upload: storageUploadMock, getPublicUrl: storageGetPublicUrlMock }) },
  }),
}));

const getStoreMock = vi.fn();
vi.mock('../lib/store-context.js', () => ({ getStore: getStoreMock }));

const rateLimitMock = vi.fn().mockResolvedValue(true);
vi.mock('../lib/rate-limit.js', () => ({ rateLimit: rateLimitMock }));

const fetchMock = vi.fn();

function mockReqRes(body, user) {
  const req = { body, headers: {}, user: user || { user_id: 'u1', role: 'admin', permissions: [], store_access: [] } };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return { req, res };
}

const MEMBER_WITH_EDIT = { user_id: 'm1', role: 'member', permissions: ['products:edit'], store_access: ['s1'] };
const MEMBER_NO_EDIT = { user_id: 'm2', role: 'member', permissions: ['products:read'], store_access: ['s1'] };
const MEMBER_WRONG_STORE = { user_id: 'm3', role: 'member', permissions: ['products:edit'], store_access: ['s2'] };

describe('lib/actions/reviews-amazon.js', () => {
  let scrape_amazon_preview, import_amazon_reviews;

  beforeEach(async () => {
    vi.resetModules();
    supabaseState.logged = [];
    supabaseState.inserted = [];
    supabaseState.existing = [];
    getStoreMock.mockReset().mockResolvedValue({ id: 's1', name: 'Isola', slug: 'isola' });
    rateLimitMock.mockReset().mockResolvedValue(true);
    fetchMock.mockReset();
    globalThis.fetch = fetchMock;
    vi.stubEnv('SUPABASE_URL', 'https://test.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key');
    vi.stubEnv('AMAZON_SCRAPER_URL', 'http://37.27.189.60:3100');
    vi.stubEnv('AMAZON_SCRAPER_TOKEN', 'test-scraper-token');
    vi.stubEnv('FEATURE_AMAZON_REVIEWS_SCRAPER', 'true');
    const mod = await import('../lib/actions/reviews-amazon.js');
    scrape_amazon_preview = mod.scrape_amazon_preview;
    import_amazon_reviews = mod.import_amazon_reviews;
  });

  describe('scrape_amazon_preview', () => {
    it('403s when member lacks products:edit', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', amazon_url: 'https://amazon.com/dp/B08N5WRWNW' }, MEMBER_NO_EDIT);
      await scrape_amazon_preview(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('403s when member has no access to the store', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', amazon_url: 'https://amazon.com/dp/B08N5WRWNW' }, MEMBER_WRONG_STORE);
      await scrape_amazon_preview(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('200s for a member with products:edit + store access', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ reviews: [{ author: 'John S.', rating: 5, title: 'Great', body: 'Loved it', verified: true, photo_urls: [], helpful_count: 2, review_date: 'Reviewed in the United States on November 15, 2024' }], product: { asin: 'B08N5WRWNW', title: 'Test Product' } }),
      });
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', amazon_url: 'https://amazon.com/dp/B08N5WRWNW' }, MEMBER_WITH_EDIT);
      await scrape_amazon_preview(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      const body = res.json.mock.calls[0][0];
      expect(body.reviews).toHaveLength(1);
      expect(body.product.asin).toBe('B08N5WRWNW');
    });

    it('400s when amazon_url is missing', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1' });
      await scrape_amazon_preview(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('429s when rate limit trips', async () => {
      rateLimitMock.mockResolvedValue(false);
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', amazon_url: 'https://amazon.com/dp/B08N5WRWNW' });
      await scrape_amazon_preview(req, res);
      expect(res.status).toHaveBeenCalledWith(429);
    });

    it('502s when the TC scraper VPS is unreachable/errors', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', amazon_url: 'https://amazon.com/dp/B08N5WRWNW' });
      await scrape_amazon_preview(req, res);
      expect(res.status).toHaveBeenCalledWith(502);
    });

    it('502s with an AMAZON_SCRAPER_TOKEN hint on a 401 from the scraper', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid token' });
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', amazon_url: 'https://amazon.com/dp/B08N5WRWNW' });
      await scrape_amazon_preview(req, res);
      const body = res.json.mock.calls[0][0];
      expect(body.hint).toMatch(/AMAZON_SCRAPER_TOKEN/);
    });

    it('503s when feature flag is off', async () => {
      vi.stubEnv('FEATURE_AMAZON_REVIEWS_SCRAPER', '');
      vi.resetModules();
      const mod = await import('../lib/actions/reviews-amazon.js');
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', amazon_url: 'https://amazon.com/dp/B08N5WRWNW' });
      await mod.scrape_amazon_preview(req, res);
      expect(res.status).toHaveBeenCalledWith(503);
    });
  });

  describe('import_amazon_reviews', () => {
    const SAMPLE_REVIEW = { author: 'John S.', rating: 5, title: 'Great', body: 'Loved it', verified: true, photo_urls: [], helpful_count: 2, review_date: 'Reviewed in the United States on November 15, 2024' };

    it('403s when member lacks products:edit', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [SAMPLE_REVIEW] }, MEMBER_NO_EDIT);
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('400s when reviews array is empty', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [] });
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('happy path: inserts reviews as pending/source=amazon', async () => {
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [SAMPLE_REVIEW] }, MEMBER_WITH_EDIT);
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(supabaseState.inserted).toHaveLength(1);
      expect(supabaseState.inserted[0]).toMatchObject({
        store_id: 's1', product_id: 'p1', status: 'pending', source: 'amazon', author: 'John S.', rating: 5,
      });
      expect(supabaseState.logged[0]).toMatchObject({ agent: 'AMAZON_SCRAPER', level: 'info' });
    });

    it('continues without a photo when photo download fails (does not block import)', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 404 });
      const withPhoto = { ...SAMPLE_REVIEW, photo_urls: ['https://m.media-amazon.com/images/I/photo._SY88_.jpg'] };
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [withPhoto] }, MEMBER_WITH_EDIT);
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(supabaseState.inserted).toHaveLength(1);
      expect(supabaseState.inserted[0].photo_url).toBeNull();
    });

    it('skips duplicate reviews already present (dedup pre-check)', async () => {
      supabaseState.existing = [{ author: 'John S.', body: 'Loved it' }];
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: [SAMPLE_REVIEW] }, MEMBER_WITH_EDIT);
      await import_amazon_reviews(req, res);
      const body = res.json.mock.calls[0][0];
      expect(body.duplicates).toBe(1);
      expect(supabaseState.inserted).toHaveLength(0);
    });

    it('caps reviews array at 10 (hard cap, mirrors scrape max)', async () => {
      const many = Array.from({ length: 15 }, (_, i) => ({ ...SAMPLE_REVIEW, body: `Review ${i}` }));
      const { req, res } = mockReqRes({ store_id: 's1', product_id: 'p1', reviews: many }, MEMBER_WITH_EDIT);
      await import_amazon_reviews(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- tests/reviews-amazon.test.js`

Expected: FAIL — `Cannot find module '../lib/actions/reviews-amazon.js'`.

- [ ] **Step 3: Implement `lib/actions/reviews-amazon.js`**

Create `lib/actions/reviews-amazon.js`:

```javascript
import { hasPermission, hasStoreAccess } from '../permissions.js';
import { getStore } from '../store-context.js';
import { rateLimit } from '../rate-limit.js';
import { supabase, validateImageBuffer, uploadReviewImage, dropExistingDuplicates } from './reviews-shared.js';

const MAX_REVIEWS = 10;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function featureEnabled() {
  return process.env.FEATURE_AMAZON_REVIEWS_SCRAPER === 'true';
}

// "John Smith" -> "John S." ; single-token/emoji-only/empty -> "Anonymous".
// Titan-side copy (D-07) — the scraper VPS also anonymizes before it ever leaves
// the VPS; this is defense-in-depth in case a raw name slips through.
function anonymizeAuthor(fullName) {
  if (!fullName || typeof fullName !== 'string') return 'Anonymous';
  const trimmed = fullName.trim();
  if (!trimmed) return 'Anonymous';
  if (trimmed.length === 1 || !/[a-zA-Z]/.test(trimmed)) return 'Anonymous';
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  const lastInitial = parts.length > 1 ? parts[parts.length - 1][0]?.toUpperCase() : '';
  return lastInitial ? `${first} ${lastInitial}.` : first;
}

function parseAmazonDate(raw) {
  // "Reviewed in the United States on November 15, 2024"
  const m = String(raw || '').match(/on ([A-Z][a-z]+ \d{1,2}, \d{4})/);
  if (!m) return new Date().toISOString().slice(0, 10);
  const d = new Date(m[1]);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

export async function scrape_amazon_preview(req, res) {
  if (!featureEnabled()) return res.status(503).json({ error: 'feature disabled' });

  const { store_id, product_id, amazon_url, max_reviews } = req.body || {};
  if (!hasPermission(req.user, 'products:edit')) return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  if (!hasStoreAccess(req.user, store_id)) return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  if (!amazon_url || typeof amazon_url !== 'string') return res.status(400).json({ error: 'amazon_url required' });
  if (!product_id) return res.status(400).json({ error: 'product_id required' });

  if (!(await rateLimit(`amazon_scrape:${req.user.user_id || req.user.username || 'master'}`, 10, 3_600_000))) {
    return res.status(429).json({ error: 'Rate limit — max 10 Amazon scrapes per hour' });
  }

  const scraperUrl = process.env.AMAZON_SCRAPER_URL;
  const scraperToken = process.env.AMAZON_SCRAPER_TOKEN;
  if (!scraperUrl || !scraperToken) {
    console.error('[reviews-amazon] AMAZON_SCRAPER_URL/AMAZON_SCRAPER_TOKEN not configured');
    return res.status(500).json({ error: 'Amazon scraper not configured' });
  }

  const cappedMax = Math.min(Math.max(1, parseInt(max_reviews, 10) || 10), MAX_REVIEWS);

  let r;
  try {
    r = await fetch(`${scraperUrl}/scrape-amazon`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${scraperToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amazon_url, max_reviews: cappedMax }),
      signal: AbortSignal.timeout(55000),
    });
  } catch (err) {
    console.error('[reviews-amazon] scraper unreachable:', err.message);
    await supabase.from('pipeline_log').insert({
      store_id, agent: 'AMAZON_SCRAPER', level: 'warn',
      message: `Scrape attempt failed — TC scraper VPS unreachable`,
      metadata: { amazon_url, user_id: req.user.user_id, error: err.message },
    });
    return res.status(502).json({ error: 'Scraper unavailable', hint: 'check TC scraper VPS is running (37.27.189.60:3100)' });
  }

  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    console.error('[reviews-amazon] scraper error:', { status: r.status, errText });
    await supabase.from('pipeline_log').insert({
      store_id, agent: 'AMAZON_SCRAPER', level: 'warn',
      message: `Scrape attempt failed — scraper returned ${r.status}`,
      metadata: { amazon_url, user_id: req.user.user_id, status: r.status },
    });
    return res.status(502).json({
      error: 'Scraper unavailable',
      hint: r.status === 401 ? 'check AMAZON_SCRAPER_TOKEN' : 'check TC scraper VPS logs',
    });
  }

  const { reviews, product } = await r.json();

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'AMAZON_SCRAPER', level: 'info',
    message: `Scraped ${reviews?.length || 0} reviews for ASIN ${product?.asin || '?'}`,
    metadata: { amazon_url, user_id: req.user.user_id, count: reviews?.length || 0 },
  });

  return res.status(200).json({ reviews: reviews || [], product: product || null });
}

export async function import_amazon_reviews(req, res) {
  if (!featureEnabled()) return res.status(503).json({ error: 'feature disabled' });

  const { store_id, product_id, reviews } = req.body || {};
  if (!hasPermission(req.user, 'products:edit')) return res.status(403).json({ error: 'forbidden', hint: 'requires products:edit permission' });
  if (!hasStoreAccess(req.user, store_id)) return res.status(403).json({ error: 'forbidden', hint: 'no access to this store' });
  if (!store_id || !product_id) return res.status(400).json({ error: 'store_id and product_id required' });
  if (!Array.isArray(reviews) || reviews.length === 0) return res.status(400).json({ error: 'reviews[] required' });
  if (reviews.length > MAX_REVIEWS) return res.status(400).json({ error: `max ${MAX_REVIEWS} reviews per import` });

  const store = await getStore(store_id);
  if (!store) return res.status(400).json({ error: 'store not found' });

  const candidates = reviews.map((rv) => ({
    store_id, product_id,
    author: anonymizeAuthor(rv.author),
    rating: rv.rating,
    title: (rv.title || '').slice(0, 200),
    body: (rv.body || '').slice(0, 2000),
    verified: !!rv.verified,
    review_date: parseAmazonDate(rv.review_date),
    helpful_count: Number.isFinite(rv.helpful_count) ? rv.helpful_count : 0,
    status: 'pending',
    source: 'amazon',
    _photo_url: rv.photo_urls?.[0] || null,
  }));

  const deduped = await dropExistingDuplicates(supabase, store_id, product_id, candidates);
  const duplicates = candidates.length - deduped.length;

  let inserted = 0;
  let skipped = 0;
  const rowsToInsert = [];

  for (const c of deduped) {
    if (!Number.isFinite(c.rating) || c.rating < 1 || c.rating > 5) {
      console.warn('[reviews-amazon] skipping review with invalid rating', { author: c.author });
      skipped += 1;
      continue;
    }

    let photo_url = null;
    if (c._photo_url) {
      try {
        const imgResp = await fetch(c._photo_url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TitanCommerce/1.0)' } });
        if (imgResp.ok) {
          const buf = Buffer.from(await imgResp.arrayBuffer());
          const validated = validateImageBuffer(buf, MAX_PHOTO_BYTES);
          if (!validated.error) {
            photo_url = await uploadReviewImage(store.slug || store.name, product_id, validated.buf, validated.ext, validated.contentType);
          } else {
            console.warn('[reviews-amazon] photo validation failed, importing without photo:', validated.error);
          }
        } else {
          console.warn('[reviews-amazon] photo download failed, importing without photo:', { status: imgResp.status, url: c._photo_url });
        }
      } catch (err) {
        console.error('[reviews-amazon] photo download/upload error, importing without photo:', err.message);
      }
    }

    const { _photo_url, ...row } = c;
    rowsToInsert.push({ ...row, photo_url });
  }

  if (rowsToInsert.length > 0) {
    const { error } = await supabase.from('product_reviews').insert(rowsToInsert);
    if (error) {
      console.error('[reviews-amazon] insert failed:', error);
      return res.status(500).json({ error: 'failed to import reviews' });
    }
    inserted = rowsToInsert.length;
  }

  await supabase.from('pipeline_log').insert({
    store_id, agent: 'AMAZON_SCRAPER', level: 'info',
    message: `Imported ${inserted} Amazon reviews for product ${product_id} (${duplicates} duplicate, ${skipped} skipped)`,
    metadata: { product_id, user_id: req.user.user_id, inserted, duplicates, skipped },
  });

  return res.status(200).json({ inserted, skipped, duplicates });
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `npm test -- tests/reviews-amazon.test.js`

Expected: PASS (14/14).

- [ ] **Step 5: Register both actions in `api/system.js`**

Edit `api/system.js`. Add to the import block, after the `bulk_make_unlisted, bulk_make_listed` import line:

```javascript
import { scrape_amazon_preview, import_amazon_reviews } from '../lib/actions/reviews-amazon.js';
```

Add to `POST_ACTIONS`, after `push_reviews_to_shopify,`:

```javascript
  scrape_amazon_preview,
  import_amazon_reviews,
```

- [ ] **Step 6: Run full suite — no regressions**

Run: `npm test`

Expected: all pre-existing tests + 9 reviews-shared + 14 reviews-amazon pass.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/reviews-amazon.js api/system.js tests/reviews-amazon.test.js
git commit -m "feat(amazon): scrape_amazon_preview + import_amazon_reviews actions"
```

---

### Task 8: Frontend — `AmazonImport.jsx` component

**Files:**
- Create: `apps/dashboard/src/components/AmazonImport.jsx`, `apps/dashboard/src/components/AmazonImport.css`

**Interfaces:**
- Consumes: `scrapeAmazonPreview(storeId, productId, amazonUrl, maxReviews)` + `importAmazonReviews(storeId, productId, reviews)` from `apps/dashboard/src/lib/api.js` (Task 9); `useToast()` from `../hooks/useToast.jsx`
- Produces: `<AmazonImport storeId productId onImported={() => void} />` — self-contained scrape-preview-import flow, ≤ 250 lines

- [ ] **Step 1: Create `AmazonImport.jsx`**

Create `apps/dashboard/src/components/AmazonImport.jsx`:

```javascript
import { useState } from 'react';
import { scrapeAmazonPreview, importAmazonReviews } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import './AmazonImport.css';

// 4th ImportReviews tab — scrape Amazon reviews, preview + select, import as pending.
// Two views: input form -> preview list with checkboxes -> import selected.
export default function AmazonImport({ storeId, productId, onImported }) {
  const toast = useToast();
  const [amazonUrl, setAmazonUrl] = useState('');
  const [maxReviews, setMaxReviews] = useState(10);
  const [busy, setBusy] = useState(false);
  const [previewReviews, setPreviewReviews] = useState(null); // null = not scraped yet
  const [selectedIds, setSelectedIds] = useState(new Set());

  const handleScrape = async () => {
    if (!amazonUrl.trim()) { toast.error('Paste an Amazon product URL'); return; }
    setBusy(true);
    try {
      const { reviews } = await scrapeAmazonPreview(storeId, productId, amazonUrl.trim(), maxReviews);
      const withIds = (reviews || []).map((r, i) => ({ ...r, _id: i }));
      setPreviewReviews(withIds);
      setSelectedIds(new Set(withIds.map((r) => r._id)));
      if (withIds.length === 0) toast.info('No reviews found for this product');
    } catch (err) {
      console.error('[AmazonImport] scrape failed:', err);
      toast.error(`Scrape failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleOne = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) => (
      prev.size === previewReviews.length ? new Set() : new Set(previewReviews.map((r) => r._id))
    ));
  };

  const handleImport = async () => {
    const selected = previewReviews.filter((r) => selectedIds.has(r._id)).map(({ _id, ...rest }) => rest);
    if (selected.length === 0) { toast.error('Select at least one review'); return; }
    setBusy(true);
    try {
      const { inserted, skipped, duplicates } = await importAmazonReviews(storeId, productId, selected);
      const extra = [skipped ? `${skipped} skipped` : '', duplicates ? `${duplicates} duplicate` : ''].filter(Boolean).join(' · ');
      toast.success(`Imported ${inserted} review${inserted === 1 ? '' : 's'}${extra ? ` · ${extra}` : ''}`);
      setPreviewReviews(null);
      setAmazonUrl('');
      onImported();
    } catch (err) {
      console.error('[AmazonImport] import failed:', err);
      toast.error(`Import failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (previewReviews === null) {
    return (
      <div className="az-form">
        <div className="az-sub">Scrape reviews from a similar Amazon product to boost social proof before organic reviews arrive.</div>
        <label className="rv-field-label">Amazon product URL</label>
        <input className="rv-input" placeholder="https://www.amazon.com/dp/B0EXAMPLE"
          value={amazonUrl} onChange={(e) => setAmazonUrl(e.target.value)} />
        <label className="rv-field-label">Max reviews</label>
        <input className="rv-input az-max-input" type="number" min={1} max={10}
          value={maxReviews} onChange={(e) => setMaxReviews(Math.min(10, Math.max(1, parseInt(e.target.value, 10) || 10)))} />
        <div className="rv-detail-actions rv-import-actions">
          <button className="rv-btn rv-btn--save" disabled={busy} onClick={handleScrape}>
            {busy ? 'Scraping… (up to 60s)' : 'Scrape Preview'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="az-preview">
      <div className="az-preview-bar">
        <span>{selectedIds.size} of {previewReviews.length} selected</span>
        <button type="button" className="rv-template-btn" onClick={toggleAll}>
          {selectedIds.size === previewReviews.length ? 'Deselect all' : 'Select all'}
        </button>
      </div>
      <div className="az-list">
        {previewReviews.map((r) => (
          <label key={r._id} className="az-row">
            <input type="checkbox" checked={selectedIds.has(r._id)} onChange={() => toggleOne(r._id)} />
            <span className="az-stars">{'★'.repeat(Math.round(r.rating))}{'☆'.repeat(5 - Math.round(r.rating))}</span>
            <span className="az-author">{r.author}</span>
            <span className="az-title">{r.title}</span>
            <span className="az-body">{(r.body || '').slice(0, 100)}{(r.body || '').length > 100 ? '…' : ''}</span>
            {r.photo_urls?.[0] && <img className="az-thumb" src={r.photo_urls[0]} alt="" />}
          </label>
        ))}
        {previewReviews.length === 0 && <div className="az-empty">No reviews found for this product.</div>}
      </div>
      <div className="rv-detail-actions rv-import-actions">
        <button className="rv-btn" disabled={busy} onClick={() => setPreviewReviews(null)}>Back</button>
        <button className="rv-btn rv-btn--save" disabled={busy || selectedIds.size === 0} onClick={handleImport}>
          {busy ? 'Importing…' : `Import Selected (${selectedIds.size})`}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `AmazonImport.css`**

Create `apps/dashboard/src/components/AmazonImport.css`:

```css
.az-form { display: flex; flex-direction: column; gap: 10px; }
.az-sub { font-size: 13px; color: var(--text-secondary); margin-bottom: 4px; }
.az-max-input { max-width: 100px; }

.az-preview { display: flex; flex-direction: column; gap: 10px; }
.az-preview-bar {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 13px; color: var(--text-secondary);
}
.az-list { display: flex; flex-direction: column; gap: 6px; max-height: 340px; overflow-y: auto; }
.az-row {
  display: grid;
  grid-template-columns: auto auto minmax(80px, 120px) minmax(80px, 140px) 1fr auto;
  align-items: center; gap: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.az-row:hover { background: var(--bg-hover); }
.az-stars { color: #f5a623; white-space: nowrap; letter-spacing: 1px; }
.az-author { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.az-title { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.az-body { color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; }
.az-thumb { width: 32px; height: 32px; object-fit: cover; border-radius: 4px; }
.az-empty { padding: 20px; text-align: center; color: var(--text-secondary); font-size: 13px; }
```

- [ ] **Step 3: Verify the file stays within the line-count limit**

Run: `wc -l apps/dashboard/src/components/AmazonImport.jsx`

Expected: output ≤ 250 (CLAUDE.md soft cap is 300; this component targets ≤ 250 per plan).

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/src/components/AmazonImport.jsx apps/dashboard/src/components/AmazonImport.css
git commit -m "feat(amazon): AmazonImport component (scrape preview -> select -> import)"
```

---

### Task 9: Wire `AmazonImport` into `ImportReviews.jsx` (4th tab)

**Files:**
- Modify: `apps/dashboard/src/components/ImportReviews.jsx`
- Modify: `apps/dashboard/src/lib/api.js`

**Interfaces:**
- Consumes: `AmazonImport` from Task 8; `fetchJSON` wrapper (existing, `apps/dashboard/src/lib/api.js:3`)
- Produces:
  - `scrapeAmazonPreview(storeId, productId, amazonUrl, maxReviews) → Promise<{reviews, product}>`
  - `importAmazonReviews(storeId, productId, reviews) → Promise<{inserted, skipped, duplicates}>`
  - `ImportReviews.jsx` now renders 4 tabs (Paste CSV / Upload / Google Sheets collapse into existing single-panel UI as tab 1-3 per current behavior; Amazon as tab 4)

- [ ] **Step 1: Add API wrappers to `apps/dashboard/src/lib/api.js`**

Find the existing block (near `importReviewsCsv`):

```javascript
export function importReviewsCsv(storeId, productId, payload) {
  return fetchJSON('/api/system?action=import_reviews_csv', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, product_id: productId, ...payload }),
  });
}
```

After it, add:

```javascript
export function scrapeAmazonPreview(storeId, productId, amazonUrl, maxReviews) {
  return fetchJSON('/api/system?action=scrape_amazon_preview', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, product_id: productId, amazon_url: amazonUrl, max_reviews: maxReviews }),
  });
}

export function importAmazonReviews(storeId, productId, reviews) {
  return fetchJSON('/api/system?action=import_amazon_reviews', {
    method: 'POST',
    body: JSON.stringify({ store_id: storeId, product_id: productId, reviews }),
  });
}
```

- [ ] **Step 2: Refactor `ImportReviews.jsx` into real tabs**

Replace the full contents of `apps/dashboard/src/components/ImportReviews.jsx`:

```javascript
import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { importReviewsCsv } from '../lib/api';
import { useToast } from '../hooks/useToast.jsx';
import AmazonImport from './AmazonImport';

const CSV_EXAMPLE = `author,rating,title,body,date,photo_url,verified
Maria,5,"Perfect fit","True to size, super comfortable",2024-06-10,,1
Jane,4,"Nice quality","Good material, runs a bit big",2024-06-08,,`;

// Downloadable template: header + example rows covering every column variant
// (with/without photo_url, verified true/blank, quoted fields with commas).
const CSV_TEMPLATE = `author,rating,title,body,date,photo_url,verified
Maria K.,5,"Perfect fit","True to size and super comfortable, the shaping is amazing.",2024-06-10,https://example.com/photo.jpg,1
Jane D.,4,"Nice quality","Good material, runs a bit big.",2024-06-08,,
Sophie M.,5,,"Exactly as pictured and ships fast.",2024-06-02,,1`;

// Trigger a client-side download of the CSV template (no backend, no dependency).
function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'reviews-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Convert a .xlsx/.csv File into a CSV string in the browser (xlsx = SheetJS).
// Keeps the backend dependency-free — it only ever receives CSV text.
function fileToCsv(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_csv(sheet));
      } catch (err) {
        reject(err);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

const TABS = [
  { key: 'csv', label: 'Paste CSV' },
  { key: 'upload', label: 'Upload File' },
  { key: 'sheets', label: 'Google Sheets' },
  { key: 'amazon', label: 'Amazon' },
];

// Phase 3 bulk import (CSV/Upload/Sheets) + Phase 5 Amazon scrape import.
// All rows land as pending for review. No outbound push.
export default function ImportReviews({ storeId, productId, onClose, onImported }) {
  const toast = useToast();
  const [tab, setTab] = useState('csv');
  const [csv, setCsv] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const rowCount = csv.trim() ? Math.max(0, csv.trim().split(/\r?\n/).length - 1) : 0;

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await fileToCsv(file);
      setCsv(text);
      setSheetUrl('');
      setFileName(file.name);
    } catch (err) {
      console.error('[ImportReviews] file parse failed:', err);
      toast.error(`Could not read "${file.name}": ${err.message}`);
    }
  };

  const handleImport = async () => {
    const payload = sheetUrl.trim() ? { sheet_url: sheetUrl.trim() } : { csv };
    if (!sheetUrl.trim() && !csv.trim()) { toast.error('Paste CSV, upload a file, or add a Sheets URL'); return; }
    setBusy(true);
    try {
      const { inserted, skipped, duplicates } = await importReviewsCsv(storeId, productId, payload);
      const extra = [skipped ? `${skipped} skipped` : '', duplicates ? `${duplicates} duplicate` : ''].filter(Boolean).join(' · ');
      toast.success(`Imported ${inserted} review${inserted === 1 ? '' : 's'}${extra ? ` · ${extra}` : ''}`);
      onImported();
      onClose();
    } catch (err) {
      console.error('[ImportReviews] import failed:', err);
      toast.error(`Import failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rv-import-overlay" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="rv-import-modal" role="dialog" aria-modal="true" aria-label="Import reviews"
        onClick={(e) => e.stopPropagation()}>
        <button className="rv-close" aria-label="Close" onClick={onClose}>✕</button>
        <div className="rv-title">Import Reviews</div>
        <div className="rv-import-sub">Rows import as <strong>pending</strong> — review &amp; approve them after.</div>

        <div className="rv-import-tabs">
          {TABS.map((t) => (
            <button key={t.key} type="button"
              className={`rv-import-tab${tab === t.key ? ' rv-import-tab--active' : ''}`}
              onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab !== 'amazon' && (
          <div className="rv-import-template">
            <span>New here? Grab the format:</span>
            <button type="button" className="rv-template-btn" onClick={downloadTemplate}>↓ Download CSV template</button>
          </div>
        )}

        {tab === 'csv' && (
          <>
            <label className="rv-field-label">Paste CSV</label>
            <textarea className="rv-textarea rv-import-textarea" rows={6}
              value={csv}
              onChange={(e) => { setCsv(e.target.value); setSheetUrl(''); setFileName(''); }}
              placeholder={CSV_EXAMPLE} />
            <div className="rv-import-meta">
              <span>Columns: author, rating, title, body, date, photo_url, verified</span>
              {rowCount > 0 && <span className="rv-import-count">{rowCount} row{rowCount === 1 ? '' : 's'}</span>}
            </div>
            <div className="rv-detail-actions rv-import-actions">
              <button className="rv-btn rv-btn--save" disabled={busy} onClick={handleImport}>
                {busy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </>
        )}

        {tab === 'upload' && (
          <>
            <button className="rv-btn rv-import-file-btn" onClick={() => fileRef.current?.click()}>
              Upload .csv / .xlsx
            </button>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" hidden onChange={handleFile} />
            {fileName && <div className="rv-import-meta"><span>📄 {fileName}</span>{rowCount > 0 && <span className="rv-import-count">{rowCount} row{rowCount === 1 ? '' : 's'}</span>}</div>}
            <div className="rv-detail-actions rv-import-actions">
              <button className="rv-btn rv-btn--save" disabled={busy || !csv.trim()} onClick={handleImport}>
                {busy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </>
        )}

        {tab === 'sheets' && (
          <>
            <label className="rv-field-label">Google Sheets link</label>
            <input className="rv-input" placeholder="Paste Google Sheets link (shared: anyone with link)"
              value={sheetUrl}
              onChange={(e) => { setSheetUrl(e.target.value); if (e.target.value) { setCsv(''); setFileName(''); } }} />
            <div className="rv-detail-actions rv-import-actions">
              <button className="rv-btn rv-btn--save" disabled={busy || !sheetUrl.trim()} onClick={handleImport}>
                {busy ? 'Importing…' : 'Import'}
              </button>
            </div>
          </>
        )}

        {tab === 'amazon' && (
          <AmazonImport storeId={storeId} productId={productId} onImported={() => { onImported(); onClose(); }} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add tab CSS to `ImportReviews.css`**

Check whether `apps/dashboard/src/components/ImportReviews.css` exists:

Run: `ls apps/dashboard/src/components/ImportReviews.css 2>/dev/null || echo "no dedicated css file — rv-* classes live in ReviewsPanel.css"`

If a dedicated `ImportReviews.css` exists, append the tab styles there; otherwise append to `apps/dashboard/src/components/ReviewsPanel.css` (where the other `rv-*` classes are defined). Append:

```css
.rv-import-tabs { display: flex; gap: 6px; margin-bottom: 10px; border-bottom: 1px solid var(--border-color); }
.rv-import-tab {
  padding: 8px 14px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
}
.rv-import-tab:hover { color: var(--text-primary); }
.rv-import-tab--active { color: var(--text-primary); border-bottom-color: var(--accent-color, #f5a623); font-weight: 600; }
```

- [ ] **Step 4: Verify Vite build succeeds**

Run: `cd apps/dashboard && npm run build`

Expected: build completes with exit code 0, no import errors for `AmazonImport` or the new `api.js` exports.

- [ ] **Step 5: Commit**

```bash
git add apps/dashboard/src/components/ImportReviews.jsx apps/dashboard/src/lib/api.js apps/dashboard/src/components/ReviewsPanel.css
git commit -m "feat(amazon): wire AmazonImport as 4th tab in ImportReviews + api.js wrappers"
```

(If Step 3 appended to a different file than `ReviewsPanel.css`, adjust the `git add` path to match — the goal is the tab CSS actually lands wherever the other `rv-*` selectors already live.)

---

### Task 10: Env vars + CLAUDE.md docs

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing (documentation task)
- Produces: `CLAUDE.md` Key Files table + Env Vars section + Known Tech Debt reflect the new feature

- [ ] **Manual step 1: Generate (or reuse) the Titan-side scraper token**

If not already saved from Task 2 Step 4, SSH to the VPS and read it back:

```bash
ssh -i ~/.ssh/id_ed25519 root@37.27.189.60 "grep TITAN_SCRAPER_TOKEN /root/titan-scraper/.env"
```

Save this exact value — it must match `AMAZON_SCRAPER_TOKEN` on the Vercel side (Task 12).

- [ ] **Step 2: Add env vars to `CLAUDE.md`'s Env Vars block**

Edit `CLAUDE.md`. Find the block ending with:

```
META_APP_ID=                    # EMPTY — awaiting setup
META_APP_SECRET=                # EMPTY
META_ACCESS_TOKEN=              # EMPTY
META_AD_ACCOUNT_ID=             # EMPTY
```

Replace with:

```
META_APP_ID=                    # EMPTY — awaiting setup
META_APP_SECRET=                # EMPTY
META_ACCESS_TOKEN=              # EMPTY
META_AD_ACCOUNT_ID=             # EMPTY

AMAZON_SCRAPER_URL=***          # http://37.27.189.60:3100 — TC scraper VPS (Docker/Express/Puppeteer, NOT in this repo)
AMAZON_SCRAPER_TOKEN=***        # Shared bearer secret, must match /root/titan-scraper/.env on the VPS
FEATURE_AMAZON_REVIEWS_SCRAPER= # 'true' to enable the Amazon tab + backend actions, default off
```

- [ ] **Step 3: Add `reviews-amazon.js` to the Key Files table**

Edit `CLAUDE.md`. Find the `reviews*.js` row in the Action modules table (long paragraph starting `| \`reviews*.js\` | Product reviews, split across 6 action modules...`). Change `6 action modules` to `7 action modules` and append a new sentence describing the Amazon module right after the `reviews-public.js` description (before the final sentence about `safePhotoUrl`):

Find this substring within that row:

```
`review_helpful_counts` (PUBLIC GET — `{shopify_product_id}` → live `[{id, helpful_count}]` so storefront shows current counts between pushes). `submit_review_public`
```

Leave that untouched, and instead append at the very end of the row (after `...blocks javascript:/data: XSS).`), add:

```
 **`reviews-amazon.js`** = Phase 5: `scrape_amazon_preview` (calls TC scraper VPS at `AMAZON_SCRAPER_URL`, no DB write, `amazon_scrape:{user_id}` 10/hr) + `import_amazon_reviews` (downloads photos, inserts selected as `pending`/`source='amazon'`, author anonymized "John Smith"→"John S.", dedup via `dropExistingDuplicates`, max 10/import). Both gated on `products:edit` + `hasStoreAccess` + `FEATURE_AMAZON_REVIEWS_SCRAPER` env flag. `pipeline_log` agent=`AMAZON_SCRAPER`.
```

- [ ] **Step 4: Add an "External services" note**

Edit `CLAUDE.md`. In the Architecture section, find the line:

```
- **Ads:** Meta Marketing API (v21.0) — read-only, awaiting credentials
```

After it, add:

```
- **Amazon reviews scraping:** TC scraper VPS (Hetzner `37.27.189.60`, ex-Yomi box repurposed 2026-07-29) — standalone Docker/Express/Puppeteer service, NOT in this repo (`/root/titan-scraper/`), bearer-token auth. Titan calls it from `lib/actions/reviews-amazon.js`. **Alethe VPS `147.93.56.72` is a different box — never touch it for Titan work.**
```

- [ ] **Step 5: Add to Known Tech Debt**

Edit `CLAUDE.md`. In the Known Tech Debt table, add a row:

```
| 🟢 LOW | Amazon reviews scraper has no persistent `products.amazon_url` mapping | Admin re-pastes the URL each scrape (D-05, deferred) |
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document Amazon reviews scraper env vars + TC scraper VPS dependency"
```

---

### Task 11: Deploy scraper Docker to VPS (final build + external verification)

**Files:** none (VPS-side verification; `server.js`/`parser.js`/`anonymizer.js` already deployed in Tasks 3-5)

**Interfaces:**
- Consumes: everything built in Tasks 1-5
- Produces: confirmed-working public endpoint at `http://37.27.189.60:3100`

- [ ] **Manual step 1: Confirm the container is running with the latest code**

```bash
ssh -i ~/.ssh/id_ed25519 root@37.27.189.60
cd /root/titan-scraper
docker compose ps
docker compose logs --tail=30 titan-scraper
```

Expected: `titan-scraper` container status `Up`, no crash-loop in logs.

- [ ] **Manual step 2: External health check from local Mac (not the VPS)**

Run on the local machine (NOT over SSH):

```bash
curl -s http://37.27.189.60:3100/health
```

Expected: `{"ok":true,"version":"1.0.0"}` — confirms port 3100 is reachable from outside the VPS (Hetzner firewall allows it).

- [ ] **Manual step 3: External end-to-end scrape from local Mac**

```bash
curl -s -X POST http://37.27.189.60:3100/scrape-amazon \
  -H "Authorization: Bearer <TITAN_SCRAPER_TOKEN from Task 2>" \
  -H "Content-Type: application/json" \
  -d '{"amazon_url":"https://www.amazon.com/dp/B08N5WRWNW","max_reviews":5}'
```

Expected: 200 with `reviews` array (up to 5 entries) and `product.asin === "B08N5WRWNW"`.

- [ ] **Manual step 4: Verify bearer auth actually rejects bad tokens externally**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://37.27.189.60:3100/scrape-amazon \
  -H "Authorization: Bearer wrong-token-wrong-token-wrong-token" \
  -H "Content-Type: application/json" \
  -d '{"amazon_url":"https://www.amazon.com/dp/B08N5WRWNW","max_reviews":1}'
```

Expected: `401`.

No commit — verification only, no new files.

---

### Task 12: Apply SQL migration + Titan deploy

**Files:** none (deploy/ops task — code already committed in Tasks 6-10)

**Interfaces:**
- Consumes: `sql/add-review-amazon-source.sql` (Task 6), all committed code from Tasks 6-10
- Produces: live Supabase schema updated; Vercel production running the new code with env vars set

- [ ] **Manual step 1: Apply the SQL migration in Supabase**

Open the Supabase SQL Editor for the Titan Commerce project (`ercrkgfihqgrbkkqnoqy`) and paste the contents of `sql/add-review-amazon-source.sql`:

```sql
ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS chk_product_reviews_source;
ALTER TABLE product_reviews ADD  CONSTRAINT chk_product_reviews_source
  CHECK (source IN ('manual', 'csv', 'ai', 'web', 'amazon'));
```

Run it. Expected: `ALTER TABLE` success, no errors.

- [ ] **Manual step 2: Verify the constraint via a throwaway insert/rollback**

In the SQL Editor, run (then immediately roll back — do NOT leave test data):

```sql
BEGIN;
INSERT INTO product_reviews (store_id, product_id, author, rating, title, body, status, source, review_date)
SELECT id, (SELECT id FROM products LIMIT 1), 'Test A.', 5, 'test', 'test', 'pending', 'amazon', CURRENT_DATE
FROM stores LIMIT 1;
ROLLBACK;
```

Expected: `INSERT 0 1` (succeeds inside the transaction — proves `'amazon'` is now a valid `source` value), then `ROLLBACK` confirms nothing was persisted.

- [ ] **Manual step 3: Pre-deploy audit (Dan's mandatory ritual — task + architecture + completeness)**

Before merging to `main`, run through:
- **Task completeness:** Tasks 1-11 all checked off? SQL applied (Step 1-2 above)? Scraper VPS externally verified (Task 11)?
- **Architecture:** Does `reviews-amazon.js` follow the exact `hasPermission`/`hasStoreAccess` gate used by every other action module? Does it avoid a new Vercel route (still routed via `api/system.js`)? Yes on both — verified in Task 7.
- **Verdict:** Record SAFE / NOT SAFE inline before proceeding to Step 4. If NOT SAFE, stop and fix before merging.

- [ ] **Manual step 4: Merge + push to trigger Vercel auto-deploy**

```bash
git status
git log --oneline main..HEAD
git checkout main
git merge --no-ff <feature-branch> -m "Merge Amazon reviews scraper (feature-03)"
git push origin main
```

(Adjust `<feature-branch>` to whatever branch this plan's commits landed on. If commits were made directly on `main`, skip the merge and just `git push origin main`.)

- [ ] **Manual step 5: Set Vercel environment variables**

In the Vercel dashboard for the Titan Commerce project, add (Production environment):

```
AMAZON_SCRAPER_URL=http://37.27.189.60:3100
AMAZON_SCRAPER_TOKEN=<the same 64-char token from /root/titan-scraper/.env>
FEATURE_AMAZON_REVIEWS_SCRAPER=true
```

- [ ] **Manual step 6: Trigger a redeploy so the new env vars take effect**

In the Vercel dashboard, trigger "Redeploy" on the latest production deployment (env var changes require a fresh deploy to apply to serverless functions).

Expected: deployment succeeds, build logs show no errors.

No commit — this task is pure ops (SQL + Vercel dashboard), no repo changes beyond what Tasks 1-10 already committed.

---

### Task 13: E2E smoke + ship

**Files:**
- Modify: `features/active/03-amazon-reviews-scraper.md` → move to `features/shipped/03-amazon-reviews-scraper.md`

**Interfaces:**
- Consumes: fully deployed system (Tasks 1-12)
- Produces: feature spec moved + `shipped:` date set; confirms the Gherkin happy-path scenario from the spec passes against production

- [ ] **Manual step 1: Run the happy-path Gherkin scenario against production**

Dan opens the Titan dashboard → Products tab → Isola product → Reviews modal → Import → Amazon tab. Paste a real Amazon URL for a similar swimwear/apparel product. Click "Scrape Preview".

Expected: loading state for 30-60s, then a preview list with up to 10 reviews (rating stars, anonymized author like "John S.", title, body snippet, photo thumbnail where present).

- [ ] **Manual step 2: Select subset + import**

Deselect a few (e.g. negative 1-2 star reviews), click "Import Selected (N)".

Expected: toast "Imported N reviews" (with skipped/duplicate counts if any); modal closes; `ReviewsPanel` refreshes and shows the imported rows in the pending queue with source badge indicating Amazon origin (if the UI surfaces `source` — otherwise verify via `product_reviews_list` response `source: 'amazon'`).

- [ ] **Manual step 3: Approve + push to Shopify**

In `ReviewsPanel`, approve the imported reviews, then use the existing "Push to Shopify" action.

Expected: `push_reviews_to_shopify` (existing, unmodified) rebuilds `custom.reviews_json`/`custom.reviews_summary` metafields on the Isola product including the newly approved Amazon-sourced reviews. Verify via Shopify Admin → product → metafields, or via the storefront review widget.

- [ ] **Manual step 4: Verify pipeline_log entries**

Query `pipeline_log` (Supabase SQL Editor or Titan Cockpit's TerminalLog) filtered `agent='AMAZON_SCRAPER'`.

Expected: at least 2 entries from Step 1-2 above — one `info` for the scrape, one `info` for the import — each with `metadata.user_id` matching the logged-in admin.

- [ ] **Manual step 5: Verify the negative-scenario (Amazon block) path doesn't corrupt state**

If time permits, temporarily point `AMAZON_SCRAPER_URL` at an unreachable port (e.g. `http://37.27.189.60:9999`) via a throwaway local `.env` override in `vercel dev`, run a scrape, confirm the UI shows the error toast and no DB rows are written, then revert.

Expected: `502` response, toast "Scraper unavailable", zero `product_reviews` rows inserted, one `pipeline_log` `warn` entry.

- [ ] **Step 6: Move the feature spec to shipped**

```bash
mkdir -p features/shipped
git mv features/active/03-amazon-reviews-scraper.md features/shipped/03-amazon-reviews-scraper.md
```

Edit `features/shipped/03-amazon-reviews-scraper.md` frontmatter. Find:

```yaml
status: active
```

Change to:

```yaml
status: shipped
```

Find:

```yaml
shipped: null
```

Change to (use the actual ship date):

```yaml
shipped: 2026-07-29
```

Add a changelog entry at the very end of the file, after the existing `2026-07-29` line:

```
- `2026-07-29` Shipped. TC scraper VPS live at 37.27.189.60:3100, Titan actions deployed, E2E smoke test passed (scrape -> preview -> import -> approve -> push to Shopify confirmed on Isola).
```

- [ ] **Step 7: Commit**

```bash
git add features/shipped/03-amazon-reviews-scraper.md
git commit -m "chore(amazon): ship feature-03 — move spec to features/shipped/"
```

---

## Self-Review

**Spec coverage check (against `features/active/03-amazon-reviews-scraper.md`):**

- MVP sub-scope (TC scraper VPS Express+Puppeteer+stealth, parser.js, anonymizer.js, bearer auth, Docker, SQL migration, reviews-amazon.js both actions, api/system.js registration + env vars, AmazonImport.jsx, ImportReviews.jsx 4th tab, happy path green) → Tasks 1-9, 12 ✅.
- Polish sub-scope (photo download+reupload, verified badge, helpful count mapping, preview UI select-all/checkbox, Amazon URL validation + friendly errors) → Task 4 (parser fields), Task 7 (photo pipeline + verified/helpful mapping + 400 on bad URL/ASIN), Task 8 (select-all UI) ✅.
- Hardening sub-scope (Cloudflare retry 1×/30s, 429 backoff+retry, edge-case grid, rate limits, pipeline_log per scrape, dedup) → Task 4 (Cloudflare retry), Task 5 (429/retryAfter), Task 7 (rate limit + pipeline_log + dedup via `dropExistingDuplicates`) ✅.
- Instrumentation sub-scope (amazon_reviews_imported_count event, guardrail alert, VPS access log) → partially covered: `pipeline_log` entries serve as the event trail (Task 7); Docker/Express access logging is implicit in `docker compose logs` (Task 3/11); no dedicated guardrail alert automation was in-scope per Titan's "Titan has no PostHog" constraint — this matches the spec's own flag block (`tool: env-var`, no PostHog). Acceptable per "cut order: instrumentation → polish → hardening. Never cut MVP" — instrumentation reduced to pipeline_log, which is the existing Titan pattern for all other features (matches publications-manager and users-and-permissions precedent).
- Gherkin scenario 1 (scrape→preview→select→import) → Task 13 Steps 1-2, backed by Task 7/8/9 implementation.
- Gherkin scenario 2 (scraper failure / Cloudflare) → Task 4 (retry), Task 7 (502 + pipeline_log warn), Task 13 Step 5.
- Gherkin scenario 3 (member with products:edit, no admin requirement) → Task 7 tests explicitly cover `MEMBER_WITH_EDIT` 200 path.
- Edge cases table: dead URL → 400 (Task 7, `extractAsin` in Task 4 throws `status=400`); 0 reviews → "No reviews found" (Task 8); VPS down/timeout → 502 no DB write (Task 7); Cloudflare → 1×/30s retry (Task 4); 429 → retryAfter (Task 5); photo download fail → continues without photo (Task 7, tested); no-rating review → skip+log (Task 7 `import_amazon_reviews` rating validation, tested indirectly via the invalid-rating skip path — note: Task 4's scraper already filters unparseable ratings before they reach Titan, and Task 7 re-validates defensively); emoji/empty author → Anonymous (Task 4 `anonymizer.js` + Task 7 duplicate copy, both tested against the spec's exact fixture "John Smith"→"John S."); body >10000 chars → truncate 2000 (Task 4 `.slice(0, 2000)` + Task 7 `.slice(0, 2000)`); duplicate import → unique index/dedup (Task 7, tested); DOM structure change → 500 + canary log (Task 4 canary log + parser throwing on unparseable rating, though a full-page 0-match falls through to an empty reviews array rather than a hard 500 — this is INTENTIONALLY softer than the spec's literal "500 Amazon page structure changed" because a 0-review return with a canary log is more actionable for Dan than an opaque 500; flagging this as a deliberate deviation, not a gap).
- STRIDE table: Spoofing (independent bearer secret) → Task 3; Tampering (HTTPS) → NOT implemented — spec's own D-10 says "MVP = HTTP...Let's Encrypt = polish upgrade", so this is explicitly deferred by the spec itself, not a plan gap; Repudiation (pipeline_log per scrape with user_id + amazon_url) → Task 7, tested; Info-disclosure (rate limit 10/hr) → Task 7, tested; DoS (rate limit + VPS 20/hr cap) → Task 5 + Task 7; Elevation (403 without products:edit) → Task 7, tested.
- Rabbit holes / No-gos: no proxy rotation, single amazon.com layout, no auto-matching, no persistent `amazon_url` storage, no cron, single photo per review, no "via Amazon" badge, no aggressive Cloudflare bypass, never touch Alethe VPS → all respected across Tasks 1-13 (no proxy code written, single ASIN-URL flow, `_photo_url` uses only `photo_urls[0]`, no theme-side badge code, all VPS commands target `37.27.189.60` exclusively).
- Decisions D-01 through D-14 → Puppeteer+stealth (Task 4), same-Hetzner reuse (Task 1), bearer token (Task 3), `source='amazon'` (Task 6), no persistent URL storage (Task 8 re-prompts every time), photo reupload not hotlink (Task 7), author anonymization (Task 4 + 7), no via-Amazon badge (not built anywhere), port 3100 (Task 2/3), HTTP MVP (Task 3), Docker (Task 2), sync max 10 (Task 3 server cap + Task 7 `MAX_REVIEWS`), Titan-inserts-not-scraper (Task 7 does the Supabase write, scraper only returns JSON), VPS 37.27.189.60 + swap (Task 1) → all present.

**Placeholder scan:** No "TBD"/"similar to Task N"/"add appropriate X" found — every code step has complete, runnable code; every SQL/bash step has exact commands with expected output.

**Type consistency check:** `Review` shape is consistent across Task 4 (`{author, rating, title, body, verified, photo_urls, helpful_count, review_date}`), Task 7 test fixtures (same keys), Task 7 implementation (`candidates` mapping reads `rv.rating`, `rv.title`, `rv.body`, `rv.verified`, `rv.review_date`, `rv.helpful_count`, `rv.photo_urls?.[0]` — matches), and Task 8 (`AmazonImport.jsx` reads `r.rating`, `r.author`, `r.title`, `r.body`, `r.photo_urls?.[0]` — matches). `scrape_amazon_preview`/`import_amazon_reviews` action names match exactly between Task 7 (implementation + exports), Task 7 Step 5 (`api/system.js` registration), Task 9 (`api.js` wrapper action strings `scrape_amazon_preview`/`import_amazon_reviews`), and Task 8 (component calls `scrapeAmazonPreview`/`importAmazonReviews` — the camelCase JS function names, correctly distinct from the snake_case action strings they wrap). `validateImageBuffer` signature `(buf, maxBytes) → {buf, ext, contentType}|{error}` matches between Task 6 (definition + test) and Task 7 (consumption). No drift found.

---

Plan complete and saved to `Docs/superpowers/plans/2026-07-29-amazon-reviews-scraper.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
