---
id: feature-02
slug: users-and-permissions
status: shipped
appetite: medium              # 4 dev-days
owner: dan
created: 2026-07-24
shipped: 2026-07-27
flag:
  name: feature.users_and_permissions.enabled
  tool: env-var                # Titan nemá PostHog → process.env.FEATURE_USERS_AND_PERMISSIONS
  default: off
  cleanup_by: 2026-10-01
depends_on: []                                  # feature-01 is shipped; products:publications perm gates its actions
blocks: []
informs: []
files_owned:
  - sql/add-users-and-permissions.sql
  - lib/actions/users.js
  - lib/permissions.js
  - apps/dashboard/src/pages/Settings.jsx
  - apps/dashboard/src/components/settings/**   # UsersManager/UserForm/PermissionCheckboxes/StoreAccessCheckboxes (+.css)
  - apps/dashboard/src/components/PermissionGate.jsx
  - tests/users.test.js
  - tests/permissions.test.js
  - tests/auth-multi-user.test.js
files_shared:
  - api/auth/login.js            # accept {username, password} + APP_PASSWORD fallback
  - lib/auth.js                  # verifyAuth returns full user; hasPermission + hasStoreAccess exported
  - api/system.js                # register 5 new users.* actions
  - lib/actions/*.js              # ~15 files — each action module gets a permission + store_access check
  - apps/dashboard/src/pages/App.jsx           # tab visibility, store filter, Settings tab
  - apps/dashboard/src/pages/Login.jsx         # username field
  - apps/dashboard/src/pages/Products.jsx      # per-permission button visibility
  - apps/dashboard/src/components/{ProductDetail,ImageManager}.jsx  # disabled per permission
  - apps/dashboard/src/hooks/useActiveStore.jsx        # filter to user.store_access
  - apps/dashboard/src/lib/api.js               # users_list/create_user/etc wrappers
  - CLAUDE.md                     # document users table, permissions, admin flow
---

# Users & Permissions

> Per-user login with granular permissions and per-store access, replacing the single shared `APP_PASSWORD` so collaborators can be onboarded without a master-password handout.

## Job story

Když má více spolupracovníků přístup do Titan Commerce (např. konkrétní člověk pro Isola product editing),
I want to mít per-user účty s granulárními permissions a per-store access,
so I can kontrolovat co kdo vidí a mění, bez sdílení jednoho master hesla `APP_PASSWORD`.

## Problem (Shape Up)

**Dnešní stav:** Titan má jediné globální heslo (`APP_PASSWORD` env var). Session token obsahuje jen `{authenticated: true, created, expires}` — žádná user identita, žádné role. Všichni sdílí to samé heslo → nulová auditovatelnost, nulový per-store scoping, nulové granular permissions.

**Cost of not shipping:** Dan nemůže bezpečně přidat spolupracovníky (např. Isola product editor by měl access ke všem 3 stores). Musí sdílet heslo → riskuje že člověk klikne někde, kde nechce (Profit tab s marže/COGS, Elegance House místo Isoly, generovat drahé AI kreativy). Jinak musí všechno dělat sám.

## Appetite

`medium (4 dev-days)`. Kill at 1.5× (6 dev-days) bez zelených AC.

## Solution sketch (rough — NOT a design spec)

- Nová tabulka `users` (username unique, password_hash bcrypt, role, permissions text[], store_access uuid[], email nullable placeholder)
- Nový login endpoint akceptuje `{username, password}` (nahradí `{password}` — starý `APP_PASSWORD` zůstává jako master fallback)
- Session token rozšířen: `{user_id, role, permissions, store_access, created, expires}`
- `withAuth()` middleware naplní `req.user` s celou strukturou
- 2 nové helpers: `hasPermission(req.user, perm)` a `hasStoreAccess(req.user, store_id)` — každá action volá na začátku
- Systematicky projít všechny action moduly v `lib/actions/*` a přidat permission checks (~20 modulů, ~40 actions)
- Frontend: store switcher filtruje `user.store_access`, taby (Studio/Avatars) hidden bez `creatives:generate`, admin-only tab "Settings > Users" s CRUD UI
- 1× SQL migrace + bcrypt (nová npm dependency — schválené s `--legacy-peer-deps`)

## Acceptance criteria (Gherkin)

```gherkin
Scenario: Member user can only edit products in assigned stores
  Given jsem user "petr" s role='member', permissions=['products:read','products:edit'], store_access=[Isola-uuid]
  When se přihlásím s username=petr + password=...
  Then vidím jen Products tab (Cockpit/Shopify/Studio/Avatars/Profit skryté)
  And store switcher dropdown obsahuje jen "Isola" (ne Elegance House ani Eleganz Haus)
  And když otevřu Product Editor pro Isola produkt, můžu upravit title/description/tagy/status/ceny
  And když se pokusím API POST /api/system?action=update_product_full s store_id=Elegance-House-uuid
  Then dostanu 403 forbidden s error message "store access denied"

Scenario: Member without images permission cannot upload images
  Given jsem user "read-only" s permissions=['products:read'], store_access=[Isola-uuid]
  When otevřu Product Editor
  Then ImageManager je viditelný ale všechny buttony (upload/delete/reorder) jsou disabled
  And když se pokusím API POST s image upload action
  Then dostanu 403 forbidden

Scenario: Admin creates new member user
  Given jsem admin s role='admin' + admin:users permission
  When otevřu Settings > Users tab
  And kliknu "Create user"
  And vyplním { username: "jana", password: "jana123", role: "member",
      permissions: ['products:read','products:edit','products:images'],
      store_access: [Isola-uuid] }
  Then user "jana" je vytvořen v DB s bcrypt password hash
  And UI zobrazí success toast
  And UI zobrazí temporary password kopírovatelný (protože já ho poslu Janě mimo systém)
  And když se Jana zkusí přihlásit s jana/jana123, funguje to
```

## Edge cases (Happy / Sad / Weird / Hostile-STRIDE)

| Quadrant | Case | Handling |
|---|---|---|
| **Happy** | Admin → member create → login → edit v přiřazeném store | Full flow green (Gherkin) |
| **Happy** | `APP_PASSWORD` master backdoor | Emergency fallback vždy dostupný |
| **Sad** | User zapomene heslo | Admin reset → temp password |
| **Sad** | Admin smaže sám sebe | Blokováno — poslední admin chráněn |
| **Sad** | Smazaný user má aktivní session | Next req → 401 (backend re-verifies user existence) |
| **Sad** | Store smazán v `user.store_access` | Filter out on read, no error |
| **Weird** | `store_access=[]` | Login OK, empty dropdown + Products |
| **Weird** | Admin s explicitně `permissions=[]` | Admin role trumps |
| **Weird** | Permission `'foo:bar'` | Ignored, no crash |
| **Weird** | Duplicate username | 400 s clear message |
| **Weird** | `APP_PASSWORD` token bez `user_id` | Fallback = admin-like, `pipeline_log` agent=`MASTER` |
| **Hostile — S** | Session token pro smazaného usera | 401 |
| **Hostile — T** | Změna `permissions` v tokenu | HMAC odmítne |
| **Hostile — T** | Cizí `store_id` v request body | `hasStoreAccess()` → 403 |
| **Hostile — R** | Admin akce (user CRUD) | `pipeline_log` agent=`AUTH_ADMIN` |
| **Hostile — I** | `password_hash` výstup | NIKDY — `users_list` strip'ne |
| **Hostile — I** | Session token obsahuje citlivá data | Jen `{user_id, role, perms, store_access}` |
| **Hostile — D** | Login brute-force | 5/IP/min — hardening, out of MVP |
| **Hostile — E** | Member volá `admin:users` | 403 |
| **Hostile — E** | Member mění UI perms v DevTools | Backend enforce beze změny |

## Impact declarations

### Data model impact

```yaml
new_tables: [users]
new_columns: []
new_indexes: [users(username) UNIQUE, "users(role) -- role filtering"]
migrations: [sql/add-users-and-permissions.sql]
breaking: false   # additive
```

### API impact

```yaml
new_actions: [users_list, create_user, update_user, delete_user, reset_password]  # via api/system.js router — no new Vercel routes (12-route Hobby cap)
modified_files:
  - api/auth/login.js   # accepts {username, password} OR {password} (APP_PASSWORD fallback)
  - lib/auth.js          # verifyAuth returns full user; + hasPermission + hasStoreAccess
  - lib/actions/*.js     # ~15 files — permission + store_access checks
breaking: true            # session token shape changes; APP_PASSWORD fallback softens transition
auth: existing withAuth() + new hasPermission() + hasStoreAccess()
rate_limit: login attempts 5/IP/min (lib/rate-limit.js) — hardening sub-scope
```

### UI impact

```yaml
pages_touched: [/dashboard (tab visibility, store filter, Login), /dashboard/settings/users (new admin section)]
new_components:
  - Settings/{UsersManager,UserForm,PermissionCheckboxes,StoreAccessCheckboxes}.jsx  # table+CRUD / modal / selectors
  - PermissionGate.jsx   # renders children only if user has permission
shared_components_modified: [App.jsx, Login.jsx, Products.jsx, ProductDetail.jsx, VariantEditor.jsx, ImageManager.jsx, MetafieldEditor.jsx]  # tab/store/button visibility, disabled states — per permission
new_routes: []
```

## Feature flag + rollout

```yaml
flag:
  name: feature.users_and_permissions.enabled
  tool: env-var                    # process.env.FEATURE_USERS_AND_PERMISSIONS
  default: off                     # rollout safety — nový login flow, migrace, permissions
  cleanup_by: 2026-10-01
rollout:
  - { cohort: dan-only,  percent: 100, soak: 24h }   # admin login working
  - { cohort: all-users, percent: 100, soak: -    }
guardrails:
  - login success rate > 95 % (dnešní baseline: 100 %)
  - žádný 500 error na permission-related endpoints
  - APP_PASSWORD master backdoor funguje vždy (safety net)
kill_switch: flip env var → login endpoint fallback na APP_PASSWORD-only + backend přeskočí permission checks (all-authenticated = admin)
```

## Success metric (NSM + guardrail)

```
NSM:       Dan vytvoří ≥ 2 member users do 14 dnů po launchi + oba se úspěšně přihlásí
Guardrail: zero unauthorized action executions; APP_PASSWORD master login rate < 10 %; login latency p95 < 500 ms
```

## Kill criteria (MANDATORY)

- Kill if: > 1.5× appetite spent (> 6 dev-days) bez zelených AC
- Kill if: permission checks nelze konzistentně vynutit napříč všemi actions (odhalen action bypass path)
- Kill if: existing dashboard workflow rozbitý pro Dana (regression na existující features)
- Kill if: bcrypt/argon2 dependency nefunguje s Vercel serverless environment

## Sub-scopes (for scope hammering)

```
mvp:
  - Users tabulka + SQL migrace + npm install bcrypt --legacy-peer-deps
  - api/auth/login.js: accepts {username, password} + APP_PASSWORD fallback
  - lib/auth.js: verifyAuth returns full user, hasPermission + hasStoreAccess helpers
  - Backend permission checks na 5 core products actions (product_detail, update_product_full, bulk_price, updateProductImages)
  - Backend permission checks na 3 publications actions (bulk_make_unlisted, bulk_make_listed, export_products_csv)
  - Frontend: Login accepts username, store switcher filtered by user.store_access, tab visibility per permission
  - Admin UsersManager UI (list + create) — no edit/delete yet
  - Isola product editor user vytvořen a working (happy path Gherkin green)

polish:
  - Admin UsersManager: edit + delete + reset password buttons
  - Backend permission checks na zbytek actions (~30 actions — reviews, size charts, avatars, custom styles, optimize, profit)
  - PermissionGate.jsx helper komponenta pro DRY frontend gating
  - "You don't have permission" toast pro denied UI actions

hardening:
  - Rate limit login attempts (5/IP/min)
  - Audit log v pipeline_log pro admin actions (agent='AUTH_ADMIN')
  - Session invalidation na permission change (kick out user)
  - Password strength validation (min 8 chars, atd.)
  - Full edge-case grid green
  - Master backdoor logging (highlight when APP_PASSWORD použit)

instrumentation:
  - Success metric events (user_created, login_success, login_failure, permission_denied)
  - Guardrail alert (>1 % unauthorized attempts)
  - last_login tracking
```

**Cut order under time pressure: instrumentation → polish → hardening. Never cut MVP.**

## Rabbit holes / No-gos

- Don't: OAuth2/SAML SSO; self-service email reset (SMTP); 2FA/MFA; user groups / role hierarchies (jen 2 role); audit log UI
- No: shared/team accounts; session sharing napříč devices; úprava Shopify Admin session (nezávislé)

## DoD overrides

`none` — inherits project defaults.

## Related decisions / locked

- **D-01:** `bcryptjs` (pure-JS, MIT) over native `bcrypt` — Vercel serverless can't build node-gyp; cost ~30 ms/hash.
- **D-02:** App-level enforcement (Supabase service-role bypasses RLS by design). Every action in `lib/actions/*` calls `hasPermission()` + `hasStoreAccess()` at top.
- **D-03:** `PERMISSION_LIST` (final): `products:read` (baseline), `products:edit` (title/desc/tags/status/price/cogs/reviews/size chart), `products:images` (upload/delete/reorder Shopify images + push creatives — NOT generate), `products:publications` (bulk unlist/list + CSV export), `creatives:generate` (Studio + Avatars + PhotoStory + Bulk Generate), `admin:users` (implicit for role='admin').
- **D-04:** `role='admin'` implicitly grants all perms + all store_access. Explicit `permissions` on admin is ignored (admin trumps).

## Changelog (append-only)

- `2026-07-24` Spec created + self-reviewed. Post-review locks: bcryptjs chosen, PERMISSION_LIST finalized (6 perms), depends_on cleared (feature-01 shipped).
- `2026-07-26` Pre-plan lock override: `crypto.scrypt` (Node built-in, zero-dep) chosen over `bcryptjs` — no node-gyp risk on Vercel serverless.
- `2026-07-27` Shipped (bb1f07a on main). 17 commits total, 168/168 tests, 4 mid-flight fixes (T1 SQL POLICY, T3 last-admin protection, T4 timing defense, T6 poll_generations+pipeline_log gate, T7 catch{} log). First admin `dan` bootstrapped via `scripts/create-first-admin.mjs`. Login smoke passed post-deploy.
