# Feature Inventory

Capability map for Titan Commerce. IDs are monotonic; slugs never reuse.

| ID | Slug | Status | Appetite | Owner | Flag | Created | Shipped |
|---|---|---|---|---|---|---|---|
| feature-01 | publications-manager | active | medium (4d) | dan | feature.publications_manager.enabled | 2026-07-23 | — |
| feature-02 | users-and-permissions | active | medium (4d) | dan | feature.users_and_permissions.enabled | 2026-07-24 | — |

## Build waves

- **Wave 1 (no deps):** feature-01
- **Wave 2 (depends on feature-01):** feature-02

## Notes

- DoD inherited from project defaults (no `DEFINITION-OF-DONE.md` yet — TODO: run `/quality-infrastructure`).
- Slug-namespace all new identifiers per feature-plan rule #4.
