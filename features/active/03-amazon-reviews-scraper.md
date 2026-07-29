---
id: feature-03
slug: amazon-reviews-scraper
status: active
appetite: medium              # 4-5 dev-days
owner: dan
created: 2026-07-28
shipped: null
flag:
  name: feature.amazon_reviews_scraper.enabled
  tool: env-var                # Titan nemá PostHog → process.env.FEATURE_AMAZON_REVIEWS_SCRAPER
  default: off
  cleanup_by: 2026-10-31
depends_on: [feature-02-users-and-permissions]   # nové actions používají hasPermission/hasStoreAccess
blocks: []
informs: []
files_owned:
  - sql/add-review-amazon-source.sql
  - lib/actions/reviews-amazon.js
  - apps/dashboard/src/components/AmazonImport.jsx
  - apps/dashboard/src/components/AmazonImport.css
  - tests/reviews-amazon.test.js
  - /root/amazon-scraper/**              # TC scraper VPS — NOT in Titan git repo, deployed separately
files_shared:
  - api/system.js                        # register 2 new POST actions
  - lib/actions/reviews-shared.js        # optionally list 'amazon' in known sources (defensive)
  - apps/dashboard/src/components/ImportReviews.jsx  # add 4th tab
  - apps/dashboard/src/lib/api.js        # add scrapeAmazonPreview + importAmazonReviews wrappers
  - CLAUDE.md                            # document Amazon source + TC scraper VPS dependency
---

# Amazon Reviews Scraper

> Scrape Amazon product reviews and import them into Titan's review queue as `pending`, so new Isola catalog items get social proof before organic reviews arrive.

## Job story

Když spouštím novou produkty na Isola storefrontu a nemám ještě žádné recenze (nový katalog, málo prodejů),
I want to scrapenout recenze podobných produktů z Amazonu a naimportovat je do Titan reviews queue jako pending,
so I can rychle nabooostovat social proof storefrontu bez čekání na organické recenze.

## Problem (Shape Up)

**Dnešní stav:** Isola má nový storefront, málo organických recenzí per produkt. Titan Commerce má funkční Product Reviews systém (F1-F4 shipped: manual, CSV, AI-generated), ale AI-generované recenze jsou legal risk a "fake"; storefront submission čeká na reálné zákazníky (týdny/měsíce).

**Cost of not shipping:** Malý katalog Isola produktů zůstává bez social proof → nižší conversion rate → pomalejší brand growth v early days.

## Appetite

`medium (4-5 dev-days)`. Kill at 1.5× (7 dev-days) bez zelených AC.

## Solution sketch (rough — NOT a design spec)

- Nový HTTP endpoint na TC scraper VPS (existing Hetzner) — Express + Puppeteer + stealth plugin, bearer token auth, rate limited, PM2
- Titan SQL migrace: extend `product_reviews.source` CHECK constraint o `'amazon'`
- Nové Titan actions `scrape_amazon_preview` (no DB write) + `import_amazon_reviews` (insert selected jako `pending`)
- Photo download + reupload do Supabase Storage přes existing photo pipeline (`reviews-shared.js` helpers)
- Frontend: `AmazonImport.jsx` jako 4. tab v existing `ImportReviews.jsx` modalu

## Acceptance criteria (Gherkin)

```gherkin
Scenario: Admin scrapes Amazon reviews, previews, and imports 5 selected
  Given jsem admin, jsem v Products tab > Isola product > Reviews modal
  When kliknu Import a přepnu na Amazon tab
  And vložím Amazon URL "https://www.amazon.com/dp/B0EXAMPLE" a max_reviews=10
  And kliknu "Scrape Preview"
  Then loading spinner běží 30-60s
  And zobrazí se preview s 10 recenzemi (rating, anonymized author "John S.", body, checkbox checked)
  When odškrtnu 5 negativních (1-2 star) a kliknu "Import Selected (5)"
  Then 5 recenzí je vloženo jako status='pending', source='amazon'
  And ReviewsPanel se refreshne a ukáže je v pending queue, ready pro standard approve → push

Scenario: Scraper failure (Amazon blocks)
  Given jsem admin s valid Amazon URL
  When Amazon vrátí Cloudflare 503 challenge a TC scraper VPS retry (30s wait) také failuje
  Then Titan zobrazí error toast "Amazon blocked the scraper — try again in a few minutes or use CSV import fallback"
  And žádná recenze není vložena do DB
  And pipeline_log entry (agent='AMAZON_SCRAPER', level='warn') zaznamená pokus

Scenario: Non-admin member with products:edit tries to scrape
  Given jsem member s permissions=['products:read', 'products:edit'], store_access=[Isola]
  When se pokusím API POST scrape_amazon_preview
  Then dostanu 200 s reviews array (products:edit je dostačující perm)
  And můžu import_amazon_reviews stejně
  (Note: scraper není admin-only, member s products:edit ho může použít stejně jako CSV/AI import.)
```

## Edge cases (Happy / Sad / Weird / Hostile-STRIDE)

| Quadrant | Case | Handling |
|---|---|---|
| **Happy** | 10 recenzí scrapnuto, admin selektuje 5 | Importováno OK, pending, source='amazon' |
| **Happy** | Review s photo | Download + reupload do Supabase Storage `store-docs` funguje |
| **Happy** | Paginace přes 2+ stránky Amazon reviews | Parser projde stránky do dosažení max_reviews |
| **Sad** | Amazon URL neplatný (typo, dead product) | 400 s clear error |
| **Sad** | Amazon vrátí 0 recenzí (nový produkt) | Preview modal "No reviews found" |
| **Sad** | TC scraper VPS down/timeout | Titan error toast, žádný DB write |
| **Sad** | Cloudflare block | Auto-retry 1× po 30s, pak error message |
| **Sad** | Amazon rate limit (429) | Error "wait 5 minutes" |
| **Sad** | Photo download selže | Import pokračuje bez fotky, log warning, don't block |
| **Weird** | Recenze bez rating | Skip, log warning |
| **Weird** | Author name jen emoji nebo empty | Anonymize na "Anonymous" |
| **Weird** | Body > 10000 chars | Truncate na 2000 (existing Titan cap) |
| **Weird** | Duplicate import stejné recenze 2× | Unique index `uq_product_reviews_dedup(store_id, product_id, author, md5(body))` blokuje 2. insert |
| **Weird** | Amazon HTML struktura se změní | Parser fails → 500 "Amazon page structure changed, contact dev" |
| **Hostile — Spoofing (S)** | Attacker pošle valid Titan session token na TC scraper VPS | TC scraper VPS ho nepřijme — vlastní shared secret bearer token, nezávislý na Titan auth |
| **Hostile — Tampering (T)** | Man-in-middle na Titan ↔ TC scraper VPS komunikaci | HTTPS-only, Titan validuje cert |
| **Hostile — Repudiation (R)** | "Já to nescrapoval" | `pipeline_log` entry per scrape (agent='AMAZON_SCRAPER', user_id, amazon_url) |
| **Hostile — Info-disclosure (I)** | Attacker s leaked valid Titan session volá scraper | `amazon_scrape:{user_id}` rate limit 10/hr |
| **Hostile — DoS (D)** | Admin volá scrape 100× rychle | Rate limit + TC scraper VPS refuses > 20/hr total |
| **Hostile — Elevation (E)** | Member bez `products:edit` volá scraper | 403 standard perm check (`hasPermission`) |

## Impact declarations

### Data model impact

```yaml
new_tables: []
new_columns: []
new_indexes: []
migrations:
  - sql/add-review-amazon-source.sql   # extend source CHECK: 'manual','csv','ai','web','amazon'
breaking: false
```

### API impact

```yaml
new_actions:              # via api/system.js router — NO new Vercel routes (12-route cap)
  - scrape_amazon_preview  # calls TC scraper VPS, returns reviews array — no DB insert
  - import_amazon_reviews  # inserts selected reviews as pending, source='amazon'
modified_files:
  - api/system.js                    # register 2 new POST actions
  - lib/actions/reviews-shared.js    # optionally list 'amazon' in known sources (defensive)
breaking: false
auth: products:edit + hasStoreAccess
rate_limit: amazon_scrape:{user_id} 10/hour (protection proti TC scraper VPS abuse)
```

### UI impact

```yaml
pages_touched: [/dashboard#products]   # ProductWorkspace → ReviewsPanel → Import modal
new_components:
  - AmazonImport.jsx    # 4th tab in ImportReviews.jsx modal
shared_components_modified:
  - apps/dashboard/src/components/ImportReviews.jsx  # add 4th tab
  - apps/dashboard/src/lib/api.js                    # scrapeAmazonPreview + importAmazonReviews wrappers
new_routes: []
```

### External service impact

```yaml
tc_scraper_vps:
  host: 37.27.189.60
  port: TBD              # Dan zvolí unused port (default návrh 3100 — see Open Questions Q-01)
  files_created:          # NOT in Titan git repo — deployed separately on TC scraper VPS, /root/amazon-scraper/
    [package.json, server.js (Express), parser.js (Amazon DOM), anonymizer.js, ecosystem.config.js (PM2), .env]
  deps: [puppeteer, puppeteer-extra, puppeteer-extra-plugin-stealth, express]
  runtime: PM2 (auto-restart)
new_env_vars:             # Titan side
  - AMAZON_SCRAPER_URL     # http://37.27.189.60:PORT/amazon/scrape-reviews
  - AMAZON_SCRAPER_TOKEN   # shared secret bearer token
```

## Feature flag + rollout

```yaml
flag:
  name: feature.amazon_reviews_scraper.enabled
  tool: env-var                    # process.env.FEATURE_AMAZON_REVIEWS_SCRAPER
  default: off                     # rollout safety — nový external service dependency
  cleanup_by: 2026-10-31
rollout:
  - { cohort: dan-only,  percent: 100, soak: 24h }   # jen admin Dan testuje s 1 URL
  - { cohort: all-admin, percent: 100, soak: -    }
guardrails:
  - Amazon block rate < 20 % (per TC scraper VPS logs)
  - scrape p95 latency < 90 s (Puppeteer navigation + parsing)
  - žádný 500 error z TC scraper VPS během normal usage
kill_switch: flip env var → AmazonImport tab v UI hidden, backend actions vrací 503 "feature disabled"
```

## Success metric (NSM + guardrail)

```
NSM:       Dan naimportuje ≥ 30 Amazon recenzí do 14 dnů po launchi + ≥ 20 jich schválí + push na Isola storefront
Guardrail: scrape success rate > 80 % (of attempts); no legal complaint from Amazon or EU regulator do 30 dnů
```

## Kill criteria (MANDATORY)

- Kill if: > 1.5× appetite spent (> 7 dev-days) bez zelených AC
- Kill if: Amazon block rate > 50 % po 2 týdnech (scraper nefunguje spolehlivě)
- Kill if: Cease-and-desist z Amazon právního nebo takedown notice
- Kill if: TC scraper VPS Puppeteer memory leak crashuje ostatní projekty (other stopped services)

## Sub-scopes (for scope hammering)

```
mvp:              [TC scraper VPS Express+Puppeteer+stealth server, parser.js for 1 Amazon layout,
                    anonymizer.js, bearer token auth, PM2 setup, SQL migration (extend source CHECK),
                    reviews-amazon.js (scrape_amazon_preview + import_amazon_reviews), api/system.js
                    registration + env vars, AmazonImport.jsx (URL + max_reviews + preview + import),
                    ImportReviews.jsx 4th tab, happy path Gherkin green]
polish:            [photo download+reupload to Storage, verified-purchase badge, helpful count mapping,
                    preview UI sort/select-all/filter-by-rating, Amazon URL validation + friendly errors]
hardening:         [Cloudflare retry 1×/30s, 429 backoff+retry, full edge-case grid green,
                    amazon_scrape:{user_id} 10/hr rate limit, pipeline_log per scrape, dedup via unique index]
instrumentation:   [amazon_reviews_imported_count event, guardrail alert (block rate >20%/24h), TC scraper VPS access log]
```

**Cut order under time pressure: instrumentation → polish → hardening. Never cut MVP.**

## Rabbit holes / No-gos

- Don't: rotující proxy pool; multi-lang parsing (jen amazon.com pro MVP); automatic Amazon↔Isola product matching; persistent `products.amazon_url` storage; continuous cron scraping; multi-photo per review
- No: theme-side "via Amazon" badge (per Dan 2026-07-28, legal risk accepted); aggressive Cloudflare bypass (stealth OK, žádné IP rotation)
- **No: Alethe VPS 147.93.56.72** touching for anything Titan-related (hard rule)

## DoD overrides

`none` — inherits project defaults.

## Related decisions / locked

- **D-01:** Puppeteer + `puppeteer-extra-plugin-stealth` over Playwright. Více pluginů, více community. Native Puppeteer bez stealth = 95%+ Cloudflare block rate.
- **D-02:** TC scraper VPS hosting (existing Hetzner) over new Fly.io/Railway container. Reuses existing infra, no new bills, PM2 already in use.
- **D-03:** Bearer token shared secret (env var both sides) over JWT/OAuth. Simple, sufficient for internal service-to-service.
- **D-04:** `source='amazon'` new value (extend CHECK constraint) over reusing `'csv'`. Cleaner audit trail, future-proof pro `via Amazon` badge kdyby Dan změnil názor.
- **D-05:** Admin ručně vkládá Amazon URL v momentu importu (no persistent `products.amazon_url` mapping v MVP). Future feature.
- **D-06:** Photo download + reupload do Supabase Storage over hotlinking Amazon CDN. Amazon může URL invalidate, Isola storefront by měl broken images.
- **D-07:** Anonymize authors ("John Smith" → "John S.") over full name preservation. Legal-friendlejší per Dan 2026-07-28.
- **D-08:** NO theme-side "via Amazon" disclosure badge (per Dan 2026-07-28). Legal risk acknowledged.

## Related decisions — post-review locks

- **D-09:** Port **3100** na TC scraper VPS.
- **D-10:** MVP = **HTTP** (bearer-token backend-to-backend). Let's Encrypt = polish upgrade.
- **D-11:** **Docker container** (matches ex-Yomi paradigm on same VPS). Dockerfile Node 20 + Chromium apt deps + Puppeteer. `docker-compose.yml` v `/root/titan-scraper/`.
- **D-12:** **Sync request, max 10 recenzí per scrape** (fits Vercel 55s budget). No job queue. 2-3 scrapes per produkt = OK.
- **D-13:** **Titan (Vercel) vloží do Supabase**, ne scraper VPS. Scraper vrátí JSON + photo URLs. Titan downloads (~1-5 MB) + reuploads + DB insert. Konzistentní pattern.
- **D-14:** **VPS = 37.27.189.60** (ex-Yomi Hetzner, repurposed 2026-07-29). Add 2 GB swapfile před scraper provoz (Chromium OOM risk).

## Changelog (append-only)

- `2026-07-28` Spec created + self-reviewed. D-09 port, D-10 HTTP MVP.
- `2026-07-29` Rename "Yomi VPS" → "TC scraper VPS" (Yomi stopped, box repurposed). Add D-11 Docker, D-12 sync-max-10, D-13 Titan-inserts, D-14 VPS+swap. **Alethe VPS 147.93.56.72 = NEVER touch pro Titan work.**
