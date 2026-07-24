# Publications Manager — SDD Progress Ledger

Plan: docs/superpowers/plans/2026-07-23-publications-manager.md
Started: 2026-07-23
Branch: feat/publications-manager

## Task ledger

Task 1: complete (commits 9c35225..118574b, review clean)
Task 2: complete (commits 118574b..45b5859, review clean)
Task 6: complete (commits 45b5859..8010cce, review clean)
Task 3: complete (commits 8010cce..7b43694, review clean)
Task 4: complete (commits 7b43694..c783be7, review clean; sonnet review — deep pass, no findings)
Task 5: complete (commits c783be7..ce52373, review clean)
Task 7: complete (commits ce52373..d0b998c, review clean; verified prop signatures)
Task 8: complete (commits d0b998c..05c9e33, review-then-fix-then-clean; Critical statusFilter fix in 05c9e33)
Task 9 (auto part): complete (commit 065f2ec — CLAUDE.md + shipped/ move + regression 80/80). Manual E2E steps 1-6 pending Dan.

## T9 Manual E2E — SHIPPED 2026-07-24

- Step 1: SQL migration applied to prod (Dan paste, Claude verified via supabase-js).
- Step 2: Isola OAuth reauthorized with read_publications + write_publications (required clearing admin_token in DB to make Connect button appear; UI hides the button when admin_token is set — logged as UX debt).
- Step 3: Backfill run twice — Eleganz Haus got publication_id in first run (already had scope, bonus), Isola got publication_id 341706572114 after reauthorize. Elegance House failed with "API Access has been disabled" (Shopify custom app revoked; unrelated to this feature; separate concern).
- Step 4: Isola Shopify sync — 196 products (58 active, 68 draft, 70 archived); product-upsert fix preserves real status ✅.
- Step 5: Bulk unlist smoke on Isola draft products — PASS.
- Step 6: CSV export smoke — PASS. Per Dan's feedback, product_url swapped for admin_url (Shopify Admin editor link); +1 test for fallback path (81 total tests).

Extra commits post-plan:
- 435d182 feat(exports): swap CSV product_url → admin_url

FEATURE COMPLETE. Deploy: d0f0581 (initial ship) + 435d182 (CSV admin_url tweak).
