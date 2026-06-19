# Runbook — Reviews abuse / moderation

Operational guide for handling abusive or spam content from the public review system
(storefront `submit_review_public` + `vote_review_helpful`).

## How content gets in

- **Visitor reviews** arrive via `submit_review_public` → always `status='pending'`, `source='web'`.
  Nothing a visitor submits reaches the storefront until a staff member **approves + pushes** it.
- **Helpful votes** go through `vote_review_helpful` → increment `helpful_count` only.

## Built-in defenses (already active)

- **Moderation gate** — web reviews are `pending`; approval + push is required to go live. This is the main control.
- **Rate limits** (`lib/rate-limit.js`): submit `5/hr` per IP + `200/hr` global; vote `1/24h` per IP+review,
  `30/hr` per IP, `500/hr` global. Caps are **shared across all 3 stores** — a flood on one store can
  exhaust the global budget for all (acceptable trade-off vs. storage cost under IP rotation).
- **Honeypot** (`company` field), **HTML stripping** + length caps, **photo magic-byte + size** validation.

## Responding to abusive content

### A pending abusive review came in
1. Dashboard → product → **Reviews** → find it (filter by `source='web'`, status `pending`).
2. **Reject** (or **Delete**). It never went live, so no re-push needed.

### An abusive review is already LIVE on the storefront (was approved + pushed)
1. **Delete** it in the dashboard. `delete_review` removes the Storage photo + flags the product
   `dirty` (needs re-push).
2. **Push to Shopify** on that product → rebuilds the metafield without the deleted review.
   ⚠️ Until you re-push, the review **stays live on the web** (metafield is a snapshot).

### Mass spam (many web reviews at once)
- The global `200/hr` cap bounds volume. To bulk-clean, reject by source in the dashboard
  (or, with DB access, `update product_reviews set status='rejected' where source='web' and …`).
- After removing any that were published, **re-push** affected products.

### Helpful-count manipulation
- `helpful_count` is editable in the dashboard (ReviewDetail field, +/−/Zero) and bulk-settable
  via **Seed helpful**. To reset a manipulated count, set it to the correct value and re-push.

## Fake-review / "verified" — legal note

The dashboard can **generate AI reviews** and **seed helpful counts** — i.e. fabricate social proof.
The `verified` badge has legal meaning (EU/FTC rules on fake reviews + "verified purchase" claims).
**Policy:** don't publish purely fabricated reviews as genuine; only mark `verified=true` for real
verified purchases. Real reviews (CSV import of genuine reviews, or web submissions) are the
recommended source.

## Quick reference

| Situation | Action |
|---|---|
| Pending abusive review | Reject/Delete (no push) |
| Live abusive review | Delete → **Push to Shopify** |
| Orphaned web reviews | Reject by `source='web'` → re-push affected products |
| Bad helpful count | Edit in ReviewDetail → re-push |
