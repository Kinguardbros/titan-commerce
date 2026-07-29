---
created: 2026-07-29
feature: 04-amazon-userscript
owner: dan
---

# Research — Tampermonkey Userscript Approach

Background research feeding `features/active/04-amazon-userscript.md`.

## Tampermonkey vs Violentmonkey vs Greasemonkey

**Tampermonkey** chosen. Most popular userscript manager by install base, available on all major browsers (Chrome, Firefox, Edge, Safari, Opera) with a consistent `GM_*` API surface and stable auto-update support. Violentmonkey is a fully open-source alternative with near-identical API compatibility but a smaller install base and less familiar UI for a one-person deployment. Greasemonkey (Firefox-only, legacy) is not cross-browser and has reduced `GM_*` API support in modern versions — not a fit.

## `@updateURL` mechanism

Tampermonkey polls the `@updateURL` (or `@downloadURL`) pointed at a raw script file on a fixed interval (default ~daily, user-configurable). If the remote `@version` is newer, it silently re-downloads and installs — no action needed from Dan beyond committing a version bump. This is how the userscript stays current without manual reinstall as Amazon's DOM shifts.

## `GM_*` sandbox APIs

- `GM_setValue` / `GM_getValue` — persistent key-value storage scoped to the script (used to store the API token locally, outside page-accessible `localStorage`)
- `GM_xmlhttpRequest` — cross-origin HTTP requests that bypass the page's CORS/CSP restrictions (the request originates from the userscript sandbox, not the Amazon page's JS context) — this is what lets the script POST to `titan-commerce.vercel.app` from an `amazon.com` page
- `GM_registerMenuCommand` — adds an entry to Tampermonkey's toolbar menu (used for a manual "Configure API token" shortcut)

## `@connect` directive

Declares which cross-origin hosts `GM_xmlhttpRequest` is permitted to reach; Tampermonkey prompts the user for one-time confirmation per new host on first use. Must list `titan-commerce.vercel.app` explicitly or the request is blocked by the extension itself (separate from Titan's own CORS check).

## Amazon marketplace domains

Amazon operates per-country domains (`.com`, `.co.uk`, `.de`, `.fr`, `.ca`, `.jp`, ...) with independent review sets — a `.de` product page shows German reviews, not the `.com` set. MVP scope is `amazon.com` only (`@match https://www.amazon.com/*` + `smile.amazon.com` alias); multi-marketplace is an explicit `@match` array extension deferred to polish (D-06 in the spec).

## Security posture

A userscript with `@match` on `amazon.com/*` has full DOM read/write access to every page load on that domain — standard for any userscript, but worth stating plainly. The API token stored via `GM_setValue` is scoped to the script's sandbox (not readable by Amazon's own page JS), but should still be treated like a password: single admin-generated value, one-time reveal in the Titan UI, rotate-on-suspected-leak via `generate_api_token` regenerate, never logged in plaintext server-side (only its presence/validity is logged to `pipeline_log`).
