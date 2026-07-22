# Shopify Publications API (GraphQL Admin API 2024+)

## Model: `status` vs `Publications`

Shopify separates two orthogonal concepts:

- **Product `status`** (`ACTIVE`, `DRAFT`, `ARCHIVED`) — lifecycle state. `DRAFT` hides the product across all sales channels; `ACTIVE` makes it eligible for publication; `ARCHIVED` removes it from admin lists but preserves history.
- **Publications** — per-sales-channel visibility. Even an `ACTIVE` product is invisible on Online Store unless a `Publication` record links it to the Online Store publication. Same product can be simultaneously published to Online Store, POS, Shop app, custom sales channels, etc.

A product can be `ACTIVE` yet unpublished to Online Store (e.g. B2B-only, or being staged). This is the primary use case for a Publications Manager.

## Key mutations

- `publishablePublish(id, input: [{publicationId}])` — publish an object (product, collection, article) to one or more publications.
- `publishableUnpublish(id, input: [{publicationId}])` — inverse.
- Both accept optional `publishDate` for scheduling (ISO8601).

Docs: `https://shopify.dev/docs/api/admin-graphql/2024-10/mutations/publishablePublish` [TBD verify canonical URL for 2025-01].

## Finding the Online Store publication ID

```graphql
query { publications(first: 10) { edges { node { id name } } } }
```

Returns nodes like `{id: "gid://shopify/Publication/12345", name: "Online Store"}`. Cache per shop — publication IDs are stable across a shop's lifetime but differ per shop.

## Rate limits (GraphQL cost)

`publishablePublish` costs ~10 points; `publications` query ~2 points. Standard bucket: 1000 points, refill 50/s. Bulk operations >100 items should use `bulkOperationRunMutation` or batched calls with backoff on `THROTTLED` extension errors.

## OAuth scopes

`read_publications` and `write_publications` are **required** for the publish/unpublish mutations. They are **not** implied by `read_products`/`write_products`. Adding them to the scopes list in the OAuth install URL forces a re-consent prompt for existing merchants — plan a migration flow.

Docs: `https://shopify.dev/docs/api/usage/access-scopes` [TBD verify].
