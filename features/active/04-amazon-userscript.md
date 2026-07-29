---
id: feature-04
slug: amazon-userscript
status: active
appetite: small-medium        # 2-3 dev-days
owner: dan
created: 2026-07-29
shipped: null
flag:
  name: feature.amazon_userscript.enabled
  tool: env-var                # process.env.FEATURE_AMAZON_USERSCRIPT
  default: off
  cleanup_by: 2026-10-31
depends_on: [feature-02-users-and-permissions, feature-03-amazon-reviews-scraper]
blocks: []
informs: []
files_owned:
  - sql/add-user-api-token.sql
  - scripts/titan-amazon-userscript.user.js
  - apps/dashboard/src/components/settings/ApiTokenButton.jsx
  - apps/dashboard/src/components/settings/ApiTokenButton.css
  - apps/dashboard/src/components/settings/ApiTokenDisplayModal.jsx
  - apps/dashboard/src/components/settings/ApiTokenDisplayModal.css
  - apps/dashboard/src/components/AmazonInstallGuide.jsx
  - apps/dashboard/src/components/AmazonInstallGuide.css
  - tests/api-token.test.js
files_shared:
  - lib/auth.js                          # bearer api_token → user lookup, parallel to session token
  - lib/actions/users.js                 # add generate_api_token action export
  - api/system.js                        # register action; extend CORS_ACTIONS for import_amazon_reviews
  - apps/dashboard/src/components/settings/UsersManager.jsx   # ApiTokenButton per row
  - apps/dashboard/src/components/AmazonImport.jsx             # replace scrape UI with install guide
  - apps/dashboard/src/lib/api.js        # generateApiToken wrapper
  - CLAUDE.md                            # document API tokens + userscript delivery
---

# Amazon Userscript

> Browser-side Tampermonkey userscript scrapes Amazon reviews using Dan's residential IP + logged session, POSTs to Titan's existing import pipeline — bypassing the datacenter-IP block that stalled feature-03.

## Job story

When I want to import Amazon reviews into Titan for social proof and feature-03's VPS scraper is blocked by Amazon's datacenter-IP detection,
I want to scrape reviews directly on the Amazon page via a Tampermonkey userscript in my own browser and send them to Titan's pending queue over a bearer-token API,
so I can use my residential IP + logged Amazon session — which Amazon never blocks — to get imports working end to end.

## Problem (Shape Up)

**Dnešní stav:** feature-03 shipped-with-limitation. Backend `import_amazon_reviews` action works, photo pipeline works, `AmazonImport.jsx` tab exists but is hidden behind a flag. VPS Docker container is stopped. Amazon aggressively blocks Hetzner datacenter IPs — Puppeteer + stealth plugin insufficient. Dan refuses paid residential proxy.

**Cost of not shipping:** Bez funkčního Amazon importu zůstává Isola storefront bez social proof pro nové produkty. Manuální kopírování z Amazonu do CSV trvá 5-10 min/produkt. AI-generated reviews jsou legal risk.

## Appetite

`small-medium (2-3 dev-days)` — smaller than feature-03, most infra (import action, anonymizer, users/RBAC, photo pipeline) already exists.

> Kill at 1.5× appetite (4-5 dev-days) without green ACs.

## Solution sketch (rough — NOT a design spec)

- `users.api_token` column (bearer secret) + `generate_api_token` admin action + Settings UI reveal-once modal
- `lib/auth.js` gains a bearer-token lookup path, parallel to (not replacing) the existing session-token flow
- `import_amazon_reviews` CORS-whitelisted for `https://www.amazon.com` so the userscript can POST cross-origin
- Userscript injects a floating "Import to Titan" button on Amazon product pages, scrapes the review DOM (reusing feature-03's `data-hook` selector knowledge), and POSTs to Titan with the bearer token
- `AmazonImport.jsx` repurposed from scraper UI to an install guide (download link + config steps) since the scrape now happens client-side, not server-side

## Acceptance criteria (Gherkin)

```gherkin
Scenario: Admin generates API token, installs userscript, imports 5 reviews from Amazon
  Given jsem admin s valid Titan session
  When otevřu Settings > Users, kliknu "Generate API token" u vlastního user řádku
  Then modal zobrazí 64-char hex token s "Copy" buttonem
  When zkopíruji token, nainstaluji userscript v Tampermonkey, vložím token do TM settings
  And navštívím https://www.amazon.com/dp/B0EXAMPLE
  Then userscript inject "Import to Titan" floating button
  When kliknu button, vyberu Isola store + product, potvrdím 10 reviews
  Then userscript scrapne recenze z DOM (i přes pages) a POSTne na import_amazon_reviews s bearer tokenem
  And Titan přijme (CORS whitelisted for amazon.com), autentizuje via api_token, insertne jako pending source='amazon'
  And userscript zobrazí toast "10 reviews imported, 0 duplicates"
  And v Titan Reviews queue vidím 10 pending reviews

Scenario: Member without api_token tries to use userscript
  Given jsem member s permissions=['products:read','products:edit'] ale bez generated API tokenu
  When nakonfiguruji userscript s prázdným tokenem a kliknu "Import to Titan" na Amazon
  Then userscript prompt "No API token configured — go to Titan Settings > Users to generate one"
  And žádný request na Titan není odeslán

Scenario: Invalid API token (rotated/deleted)
  Given měl jsem valid api_token ale admin ho revoked (regenerate)
  When userscript POST na import_amazon_reviews s starým tokenem
  Then Titan vrátí 401 Unauthorized
  And userscript toast "API token invalid — regenerate in Titan Settings"
```

## Edge cases (Happy / Sad / Weird / Hostile-STRIDE)

| Quadrant | Case | Handling |
|---|---|---|
| **Happy** | 10 reviews scraped, importováno OK | pending, source='amazon' |
| **Happy** | Amazon photo URLs downloaded + reuploaded | reuse F03 Supabase Storage pipeline |
| **Happy** | Multi-page reviews (10/page × 2 pages) | userscript paginates DOM until max reached |
| **Sad** | Amazon zobrazí CAPTCHA (rare, real session) | userscript shows "complete CAPTCHA, retry" |
| **Sad** | Amazon URL neplatné / Titan 401 (rotated token) | inline error / no request sent, resp. "API token invalid — regenerate" |
| **Sad** | Titan API vrátí 429 (rate limit) | userscript retry po 60s or user cancel |
| **Sad** | Product search 0 matches / photo download fail | null product_id (admin assigns later) / import continues, log warning |
| **Weird** | Amazon HTML struktura změněna → 0 matches | "0 reviews found — DOM may have changed, check console" |
| **Weird** | User has 0 store_access / review body > 2000 chars | "No stores available" / truncate (existing Titan cap) |
| **Weird** | API token contains typo | 401 → clear error message |
| **Hostile — Spoofing (S)** | Attacker POSTs from jiného origin | CORS blocks (browser-enforced) + bearer token check server-side |
| **Hostile — Tampering (T)** | Man-in-middle | HTTPS-only + bearer auth |
| **Hostile — Repudiation (R)** | "Já jsem to nescrapnul" | `pipeline_log` entry per submit (agent='AMAZON_USERSCRIPT', user_id from api_token lookup) |
| **Hostile — Info-disclosure (I)** | api_token leak → attacker submits reviews | rotate = admin regenerates; revoke = null via `update_user` |
| **Hostile — DoS (D)** | Attacker floods import_amazon_reviews | existing F03 rate limit + 10/import hard cap still applies |
| **Hostile — Elevation (E)** | Member uses userscript | same `products:edit` perm requirement as CSV import (unchanged backend check) |

## Impact declarations

### Data model impact

```yaml
new_tables: []
new_columns:
  - users.api_token TEXT UNIQUE NULL
new_indexes:
  - users(api_token) WHERE api_token IS NOT NULL   # partial index for auth lookup
migrations:
  - sql/add-user-api-token.sql
breaking: false
```

### API impact

```yaml
new_actions:
  - generate_api_token   # admin-only, generates 64-char hex, saves to users.api_token, returns once
modified_files: [lib/auth.js, lib/actions/users.js, api/system.js]  # bearer lookup, action register, CORS_ACTIONS extend
breaking: false
auth: admin:users perm for generate_api_token; bearer api_token for import_amazon_reviews from userscript
rate_limit: existing amazon_scrape:{user_id} 10/hr (F03) still applies to import_amazon_reviews
```

### UI impact

```yaml
pages_touched: [/dashboard#settings]
new_components: [ApiTokenButton.jsx, ApiTokenDisplayModal.jsx, AmazonInstallGuide.jsx]
shared_components_modified: [AmazonImport.jsx, UsersManager.jsx]
new_routes: []
```

### External deliverable

```yaml
userscript:
  file: scripts/titan-amazon-userscript.user.js
  delivery: GitHub raw URL (@updateURL) → auto-update via Tampermonkey, version bumps via commit
  match: [https://www.amazon.com/*, https://smile.amazon.com/*]
  connect: [titan-commerce.vercel.app]
  grant: [GM_setValue, GM_getValue, GM_xmlhttpRequest, GM_registerMenuCommand]
```

## Feature flag + rollout

```yaml
flag:
  name: feature.amazon_userscript.enabled
  tool: env-var                    # process.env.FEATURE_AMAZON_USERSCRIPT
  default: off
  cleanup_by: 2026-10-31
rollout:
  - { cohort: dan-only,    percent: 100, soak: 24h }
  - { cohort: admin-users, percent: 100, soak: -   }
guardrails:
  - žádný unauthorized POST na import_amazon_reviews (CORS + bearer)
  - api_token leak detection = 0 (via pipeline_log audit)
  - Amazon DOM stability > 95% (canary logs 0-match events)
kill_switch: flip env var → Amazon tab v UI hidden + CORS strip Amazon origins (userscript stays installed but requests fail with CORS)
```

## Success metric (NSM + guardrail)

```
NSM:       Dan imports ≥ 50 Amazon reviews via userscript within 14 days + approves ≥ 30 + push to Isola
Guardrail: 0 unauthorized POST (via CORS + bearer); 0 rotated tokens still working; 100% userscript success rate on valid Amazon URL
```

## Kill criteria (MANDATORY)

- Kill if: > 1.5× appetite spent (> 4-5 dev-days) bez zelených AC
- Kill if: Amazon changes DOM selectors 3× ve 2 týdnech (unmaintainable churn)
- Kill if: Tampermonkey policy blocks external HTTP POSTs (unlikely, but if happens)
- Kill if: api_token security concern (e.g. discovered token leak)

## Sub-scopes (for scope hammering)

```
mvp:
  - SQL migrace users.api_token; lib/auth.js bearer token flow (parallel to session)
  - generate_api_token action (admin-only); Settings > Users API token button + one-time reveal modal
  - CORS extension: import_amazon_reviews accepts POST from https://www.amazon.com
  - Userscript: floating button + config modal + store select + product search + scrape DOM + POST
  - AmazonImport.jsx: install guide UI (raw URL link + config steps)
  - Happy path Gherkin green (Dan generates token, installs userscript, imports 10 reviews)

polish:
  - Multi-marketplace support (amazon.co.uk, .de) — @match extension; progress indicator (page 2/3)
  - API token rotation UI (delete + regenerate); product search fuzzy match + thumbnails
  - Better error messages (network fail vs Amazon DOM change)

hardening:
  - pipeline_log audit per submit (agent='AMAZON_USERSCRIPT'); Amazon DOM canary logging (0-match detection)
  - Full edge-case grid green; userscript defensive coding (missing DOM elements, malformed pages)

instrumentation:
  - Success metric event (userscript_imported_count); guardrail alert (0-match rate >20%/24h)
  - Amazon marketplace tracking (which .com/.co.uk/.de used)
```

**Cut order under time pressure: instrumentation → polish → hardening. Never cut MVP.**

## Rabbit holes / No-gos

- Don't: automatic Amazon → Titan product matching (AI vision, fuzzy string) — admin selects manually
- Don't: batch import multiple Amazon URLs at once — one URL per click
- Don't: userscript stores scrape history — POST to Titan and done
- Don't: Chrome extension (Tampermonkey compat is enough, avoid Chrome Web Store review) or paid residential proxy (browser IS the residential IP)
- No: import bez pending status (standard approval flow); no skip photo download; no multi-photo per review (matches F03)
- **No: Alethe VPS 147.93.56.72** touching for anything Titan-related (hard rule, even though this feature doesn't touch VPS at all)

## DoD overrides

`none` — inherits project defaults.

## Related decisions / locked

- **D-01:** API token = single column `users.api_token TEXT UNIQUE` (not separate `api_tokens` table). Small operation (1-5 users), multi-token flexibility is overkill.
- **D-02:** Userscript delivery = **GitHub raw URL** with `@updateURL` — auto-update on Tampermonkey, version bumps via commit.
- **D-03:** Product matching = **search widget inside userscript modal** (fetches Titan `products_list`, filters client-side). Admin picks explicitly.
- **D-04:** Photos = **userscript sends URLs**, Titan backend downloads + reuploads to Supabase (reuse existing F03 photo pipeline).
- **D-05:** feature-04 samostatná od feature-03. F03 zůstává shipped-with-limitation, F04 = alternative approach.
- **D-06:** MVP = amazon.com only. Multi-marketplace (.co.uk, .de, ...) = polish.
- **D-07:** Bearer token flow v `lib/auth.js` = **parallel to existing session token** (not replace). Session tokens keep dashboard login working; bearer tokens are for API access from the userscript.
- **D-08:** No CSRF token — bearer is out-of-band from the session cookie, immune to CSRF by design.

## Changelog (append-only)

- `2026-07-29` Spec created.
