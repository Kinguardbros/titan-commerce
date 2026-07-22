# Titan Commerce — current state relevant to Publications Manager (2026-07-23)

Snapshot of existing code that a Publications Manager feature would touch or extend. Line numbers verified via `rg` on 2026-07-23.

## Product creation path

- `lib/product-upsert.js:25` — hardcoded `status: 'active'` at product creation. Every product Titan imports lands as ACTIVE regardless of source or intent. No control surface exists today to create as DRAFT.

## Existing status control (products, not publications)

- `lib/shopify-admin.js:266` — `async function updateProductStatus(shopifyProductId, status)` exists and is re-exported at `lib/shopify-admin.js:307`. This toggles the product's `status` field (ACTIVE / DRAFT / ARCHIVED), which is orthogonal to Publications (see `shopify-publications-api-2026-07-23.md`). Currently there is **no** analogous `publishToChannel` / `unpublishFromChannel` helper.

## OAuth scopes

- `api/auth/shopify.js:120` — scopes are injected via a `SCOPES` constant. `rg 'SCOPES' api/auth/shopify.js` shows the request scope set is `read_products, write_products` (no `read_publications`, no `write_publications`). Feature will require a scope migration + re-consent flow for installed shops.

## Bulk action pattern (reusable shape)

- `lib/actions/products.js:286` — `export async function bulk_price(req, res)`. Established Titan pattern for bulk mutations over selected products: validate shop, resolve access token, iterate product IDs with rate-limit-aware batching, aggregate result rows. Publications Manager bulk publish/unpublish should follow this same shape (`bulk_publish`, `bulk_unpublish`) to stay consistent with the existing dashboard bulk-action UI.

## Sync surface

- Products are ingested via REST `products.json` polling + webhooks (`products/create`, `products/update`). Publications data is **not** in the REST product payload — a Publications Manager needs a separate GraphQL fetch (`product { publishedOnPublication(publicationId:) }` or `resourcePublications`) to know current per-channel state. Add to sync worker as a follow-up read.

## API version

`lib/shopify-admin.js` currently pins Shopify Admin API `2024-01`. Publications mutations exist there, but `2024-10`/`2025-01` are current stable and preferred for new work.
