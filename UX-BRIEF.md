# UX Brief: Titan Commerce Dashboard — Design & Accessibility Audit

## Project: Titan Commerce Limited
**Stack:** React + Vite frontend, dark theme dashboard
**Design system:** `skills/nextbyte-design/SKILL.md` + `skills/nextbyte-design/references/design-tokens.md`
**Current state:** Functional but lacks responsive design, accessibility, and UX polish

---

## KONTEXT

Dashboard spravuje 3 e-commerce story (Elegance House, Isola, Eleganz Haus). 5 tabu: Overview, Shopify, Studio, Products, Profit. Dark theme (Nextbyte Design System). Pouzivaji ho 3 lidi v teamu — desktop i mobil.

---

## TASK 1: Responsive Design (PRIORITA)

### Problem
Pod 600px se layout rozpadá — header se prekryva, gridy nefunguji, modaly nezalamuji, touch targety jsou prilis male.

### Co opravit

**Header (App.jsx, App.css):**
- Pod 768px: hamburger menu misto horizontal tabu
- Store switcher zustava viditelny
- Clock skryt (uz se skryva na 900px — ok)
- Sign out → ikona misto textu

**KPI karty (ShopifyDashboard, Overview):**
- Pod 600px: 1 sloupec misto 3-4
- Pod 900px: 2 sloupce

**Product grid (Products.jsx):**
- Pod 600px: 1 sloupec
- Pod 900px: 2 sloupce
- List view: horizontalni scroll na tabulce

**Modaly (CreativeEditor, OptimizePanel, GeneratePanel):**
- Pod 768px: fullscreen modal (ne centered box)
- Single column layout (preview nad editorem, ne vedle)
- Close button vetsi (44px touch target)

**Proposal karty (ProposalCard):**
- Pod 600px: tlacitka Approve/Dismiss pod popisem (ne vedle)

**Pricing tabulka:**
- Pod 768px: horizontalni scroll s sticky prvnim sloupcem

### Breakpointy
```css
/* Mobile first approach */
@media (min-width: 480px) { /* small mobile → large mobile */ }
@media (min-width: 768px) { /* mobile → tablet */ }
@media (min-width: 1024px) { /* tablet → desktop */ }
@media (min-width: 1280px) { /* desktop → wide desktop */ }
```

### Touch targety
Vsechny klikatelne elementy: **minimalne 44x44px** (Apple HIG standard).
- Buttony: padding min 12px 16px
- Checkbox: 44px hit area
- Close buttons: 44x44px
- Tab buttons: min-height 44px

---

## TASK 2: Accessibility (WCAG AA)

### 2a. ARIA labels
Kazdemu interaktivnimu elementu pridat aria-label:

```jsx
// Buttony s ikonou:
<button aria-label="Close modal">✕</button>
<button aria-label="Sign out">Sign out</button>
<button aria-label="Switch to grid view">▤</button>
<button aria-label="Switch to list view">≡</button>

// Search:
<input aria-label="Search products by name" placeholder="Search..." />

// Store switcher:
<button aria-label="Switch store, currently Elegance House" aria-expanded={open}>
  Elegance House ▾
</button>

// Proposal card:
<div role="article" aria-label="Proposal: Generate 4 creatives for Summer Dress">
```

### 2b. Focus states
Pridat viditelne focus ring na VSECHNY focusable elementy:

```css
/* Globalni focus state: */
:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

/* Pro dark theme — svetly outline: */
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
a:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.2);
}
```

### 2c. Keyboard navigation
- Tab: prochazi vsechny interaktivni elementy
- Enter/Space: aktivuje buttony
- Escape: zavre modaly a dropdowny
- Arrow keys: navigace v dropdownech (store switcher, collection filter)

```jsx
// Store switcher dropdown:
onKeyDown={(e) => {
  if (e.key === 'Escape') setOpen(false);
  if (e.key === 'ArrowDown') focusNextItem();
  if (e.key === 'ArrowUp') focusPrevItem();
  if (e.key === 'Enter') selectItem();
}}
```

### 2d. Color contrast
Nektera text/bg kombinace jsou pod WCAG AA (4.5:1):

| Element | Aktualni | Problem | Fix |
|---------|----------|---------|-----|
| `--text-muted` (#52525b) na `--bg-app` (#07070c) | 3.2:1 | Pod AA | Zvysit na #71717a (4.5:1) |
| Label text (7-8px) | Prilis maly | Necitelny | Min 10px, idealne 11px |
| Filter chip inactive text | Nizky kontrast | Tezce citelny | Zvysit brightness |

### 2e. Status indikatory — ne jen barvou
Pridat ikony nebo text vedle barevnych status badges:

```jsx
// PRED (jen barva):
<span className="pill pending">pending</span>

// PO (barva + ikona):
<span className="pill pending">⏳ pending</span>
<span className="pill approved">✓ approved</span>
<span className="pill rejected">✗ rejected</span>
```

---

## TASK 3: Empty States s CTA

Kazdy prazdny stav musi mit:
1. Relevantni ikona/ilustrace
2. Jasny popis co se deje
3. Akci (CTA button) co uzivatel muze udelat

### Priklady:

**Products — zadne produkty:**
```
┌──────────────────────────────────────┐
│        📦                             │
│  No products yet                     │
│                                       │
│  Sync your Shopify products to get   │
│  started.                            │
│                                       │
│  [Sync Shopify →]                    │
└──────────────────────────────────────┘
```

**Studio — zadne kreativy:**
```
┌──────────────────────────────────────┐
│        🎨                             │
│  No creatives generated              │
│                                       │
│  Start creating branded content or   │
│  product creatives.                  │
│                                       │
│  [Generate Branded] [Select Product] │
└──────────────────────────────────────┘
```

**Overview — zadne proposals:**
```
┌──────────────────────────────────────┐
│        ✅                             │
│  All caught up!                      │
│                                       │
│  No pending proposals. Agent will    │
│  scan for events automatically.      │
│                                       │
│  [Scan Now]                          │
└──────────────────────────────────────┘
```

**Shopify — admin not connected:**
```
┌──────────────────────────────────────┐
│        🔌                             │
│  Shopify Admin not connected         │
│                                       │
│  Connect your Shopify Admin API to   │
│  see orders, revenue, and analytics. │
│                                       │
│  How to connect → (link to docs)     │
└──────────────────────────────────────┘
```

---

## TASK 4: Breadcrumbs

### Problem
V nested views (Products → ProductWorkspace → CreativeEditor) uzivatel nevi kde je.

### Fix
```
Products / Mathilda Pants              ← breadcrumb
Products / Elara Bikini / Optimize     ← breadcrumb

Studio / Branded / Lifestyle           ← breadcrumb
```

Komponenta:
```jsx
function Breadcrumbs({ items }) {
  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      {items.map((item, i) => (
        <span key={i}>
          {i > 0 && <span className="breadcrumb-sep">/</span>}
          {item.onClick ? (
            <button className="breadcrumb-link" onClick={item.onClick}>{item.label}</button>
          ) : (
            <span className="breadcrumb-current">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
```

---

## TASK 5: Tooltips a Help Text

### Kde pridat tooltips:

| Element | Tooltip text |
|---------|-------------|
| 🎨 12 (8✓) | "12 total creatives, 8 approved" |
| ⚠ 0 creatives | "This product has no creatives — generate some in Studio" |
| Revenue ↑23% | "23% increase compared to previous period" |
| Pipeline Live | "System is connected and monitoring" |
| Severity 🔴 | "High priority — action recommended" |
| Style: ad_creative | "Campaign-ready Meta ad with studio lighting and brand tones" |
| COGS | "Cost of Goods Sold — your purchase price per unit" |
| AOV | "Average Order Value — revenue divided by number of orders" |

### Implementace
```jsx
// Jednoduchy tooltip pres title attribute (zaklad):
<span title="12 total creatives, 8 approved">🎨 12 (8✓)</span>

// Nebo custom tooltip komponenta (lepsi pro styling):
<Tooltip text="12 total creatives, 8 approved">
  <span>🎨 12 (8✓)</span>
</Tooltip>
```

---

## TASK 6: Font Sizes

### Problem
Nektery labely jsou 7-8px — necitelne na mobile i desktopu.

### Fix — minimalni velikosti:
| Element | Aktualni | Fix |
|---------|----------|-----|
| Card labels (COLLECTION, PRICE, CREATIVES) | 7px | **10px** |
| Variant badge | 7px | **9px** |
| Meta data (handle, product images count) | 8px | **10px** |
| Table headers | 8px | **10px** |
| Timestamp v logu | 9px | ok |
| Body text | 13px | ok |
| KPI numbers | 26px | ok |

**Pravidlo: ZADNY text pod 9px.** Idealne minimum 10px pro labely.

---

## TASK 7: Loading UX

### Skeleton loadery misto "Loading..."

Nahradit vsechny `"Loading..."` texty skeleton komponentami:

- KPI karty → skeleton boxy (pulzujici sedy obdelniky)
- Product grid → skeleton karty
- Tabulky → skeleton radky
- Chart → skeleton blok

Viz `skills/nextbyte-design/SKILL.md` pro skeleton styling.

### Progress indikatory pro dlouhe operace

| Operace | Trvani | Aktualne | Fix |
|---------|--------|----------|-----|
| Generate image | 30-60s | "Generating 1 of 4..." | Pridat progress bar + ETA |
| Convert to video | 30-60s | "Converting..." | Pridat progress bar + ETA |
| Optimize product | 5-10s | "Optimizing..." | Spinner + "~10 seconds" |
| Shopify sync | 10-30s | "Syncing..." | "Syncing X of Y products" |
| Bulk price update | 5-15s | No feedback | Progress: "Updated X of Y" |

---

## Poradi prace

### DULEZITE: Nepis zadny backend kod. Jen frontend CSS/JSX zmeny.

1. **Responsive design** (Task 1) — breakpointy, mobile layout, touch targety
2. **Accessibility** (Task 2) — ARIA, focus states, keyboard nav, kontrast
3. **Font sizes** (Task 6) — minimum 9px vsude
4. **Empty states** (Task 3) — CTA buttony
5. **Breadcrumbs** (Task 4)
6. **Tooltips** (Task 5)
7. **Skeleton loadery** (Task 7)

---

## Design System Reference

Vse musi odpovidat `skills/nextbyte-design/SKILL.md`:
- Barvy: `--bg-app: #07070c`, `--accent-primary: #8b5cf6`, atd.
- Fonty: Michroma (headings), Plus Jakarta Sans (body), Space Mono (data)
- Border-radius: 16px karty, 10px buttony, 8px inputy
- Shadows: subtle, ne hard
- Animations: smooth transitions, skeleton shimmer
