---
created: 2026-07-28
feature: 03-amazon-reviews-scraper
owner: dan
---

# Research — Amazon Scraping Approach

Background research feeding `features/active/03-amazon-reviews-scraper.md`.

## Puppeteer vs Playwright

**Puppeteer** chosen over Playwright. Puppeteer remains more popular (larger install base, more Stack Overflow / GitHub issue coverage) and has a mature stealth-plugin ecosystem via `puppeteer-extra`. Playwright's multi-browser abstraction is unneeded here (Chromium-only target); its stealth tooling is comparatively immature. Puppeteer + `puppeteer-extra` + `puppeteer-extra-plugin-stealth` patches the ~20 known headless-Chrome fingerprints (`navigator.webdriver`, missing plugins array, WebGL vendor strings, etc.) that Cloudflare and Amazon's bot-detection check. Native Puppeteer without stealth hits Cloudflare/Amazon challenge pages on the large majority of requests in practice; the stealth plugin is the difference between a usable scraper and a non-starter.

## Amazon review HTML structure (target selectors)

Amazon review blocks are consistently marked with `data-hook` attributes, which are more stable across layout tweaks than class names:
- `div[data-hook="review"]` — one review container
- `[data-hook="review-star-rating"]` / `[data-hook="cmps-review-star-rating"]` — rating (parse from `.a-icon-alt` text, "5.0 out of 5 stars")
- `[data-hook="review-title"]` — review title/headline
- `[data-hook="review-body"] span` — review body text
- `[data-hook="genome-widget"] .a-profile-name` — author display name
- `[data-hook="avp-badge"]` — "Verified Purchase" badge presence
- `[data-hook="review-date"]` — review date string (needs locale parsing)
- `[data-hook="helpful-vote-statement"]` — helpful-vote count text
- `.review-image-tile` — review photo thumbnails (`src` attr)
- Pagination: `li.a-last a` link to next page of `/product-reviews/{ASIN}`

## Rate limits and "friendly scraping"

Target ~1 request/minute per product URL, single concurrent session, randomized 2-5s delay between page-load and DOM read (mimics human dwell time). Rotate a small pool of realistic desktop User-Agent strings per session (not per-request — Amazon flags UA-per-request as bot signal more than a fixed session UA). Respect `robots.txt` where practical (Amazon disallows `/product-reviews/` crawling for most bots — noted for the legal section below, not a technical blocker given Puppeteer renders as a browser, not a robots-aware crawler). Total scraper budget capped at 20 requests/hour across all URLs as an ops-level circuit breaker independent of Amazon's own throttling.

## Legal note

Amazon's Conditions of Use explicitly prohibit automated data collection/scraping. This is a real ToS violation with a documented (if rarely enforced against small-scale actors) legal risk — Amazon has pursued cease-and-desist and technical countermeasures (not typically litigation) against scrapers historically. Per Dan's 2026-07-28 decision: **this is an accepted business risk** ("your decision, your business") given Titan/Isola's small scale and the ad-hoc (not continuous/commercial-resale) nature of the scrape. Mitigations adopted: friendly rate limits (above), author anonymization (D-07), no "via Amazon" storefront disclosure (D-08, deliberately — avoids drawing attention while still being an internal audit trail via `source='amazon'`), and a kill criterion for any cease-and-desist received (see spec Kill criteria).
