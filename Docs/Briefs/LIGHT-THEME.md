# Developer Brief: Light Theme Redesign

## Project: Titan Commerce Limited
**Scope:** CSS-only theme migration (dark → light)
**Risk:** Low — all colors are in CSS variables, no component logic changes

---

## CIL

Prepnout dashboard z ultra-tmaveho dark theme (#07070c) na svetly, ciste profesionalni light theme. Zadne zmeny v komponentach, pouze CSS variables + drobne upravy kde jsou hardcoded barvy.

---

## AKTUALNI STAV

```
Background:   #07070c (skoro cerna)
Cards:        #14141e (tmave fialova)
Text:         #f1f1f4 (bila)
Accent:       #8b5cf6 (violet)
Secondary:    #f59e0b (gold/amber)
Borders:      rgba(255,255,255,0.06-0.08)
```

Design system: "Nextbyte Dark Luxe" — Michroma (headings), Plus Jakarta Sans (body), Space Mono (mono)

---

## CILOVY STAV — "Titan Light"

### Barvy (`:root` v App.css)

```css
:root {
  /* Backgrounds */
  --bg-app: #f5f5f7;              /* svetle sede (Apple-style) */
  --bg-surface: #ffffff;           /* cisty bily */
  --bg-surface-hover: #f0f0f3;    /* jemne hover */
  --bg-card: #ffffff;              /* bily card */
  --bg-card-hover: #fafafa;       /* jemny hover */
  --bg-card-elevated: #ffffff;     /* elevated = bily + shadow */
  --bg-overlay: rgba(0,0,0,0.3);  /* tmavsi overlay */
  --bg-input: #f5f5f7;            /* input bg */

  /* Accents — ZACHOVAT */
  --accent-primary: #7c3aed;       /* o trochu tmavsi violet pro kontrast na bilem */
  --accent-primary-hover: #6d28d9;
  --accent-primary-soft: rgba(124,58,237,0.08);
  --accent-secondary: #d97706;     /* tmavsi gold pro kontrast */
  --accent-secondary-soft: rgba(217,119,6,0.08);
  --accent-tertiary: #ca8a04;      /* tmavsi gold */
  --accent-success: #16a34a;       /* tmavsi green */
  --accent-success-soft: rgba(22,163,74,0.08);
  --accent-danger: #dc2626;        /* tmavsi red */
  --accent-danger-soft: rgba(220,38,38,0.08);

  /* Gradients */
  --gradient-heading: linear-gradient(135deg, #7c3aed 0%, #d97706 100%);

  /* Text */
  --text-primary: #1a1a2e;         /* tmavy text */
  --text-secondary: #6b7280;       /* grey-500 */
  --text-muted: #9ca3af;           /* grey-400 */

  /* Borders */
  --border-subtle: rgba(0,0,0,0.06);
  --border-default: rgba(0,0,0,0.10);
  --border-hover: rgba(124,58,237,0.25);

  /* Shadows — dulezite pro hloubku na bilem pozadi */
  --shadow-card: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  --shadow-card-hover: 0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06);
  --shadow-dropdown: 0 8px 24px rgba(0,0,0,0.12);

  /* Typography — ZACHOVAT */
  --font-display: 'Michroma', sans-serif;
  --font-body: 'Plus Jakarta Sans', sans-serif;
  --font-mono: 'Space Mono', monospace;
}
```

### Legacy aliases — updatovat:

```css
  --void: var(--bg-app);
  --abyss: var(--bg-surface);
  --deep: var(--bg-card);
  --surface: var(--bg-surface);
  --raised: var(--bg-card-hover);
  --edge: var(--border-subtle);
  --edge2: var(--border-default);
  --text: var(--text-primary);
  --text2: var(--text-secondary);
  --text3: var(--text-secondary);
  --text4: var(--text-muted);
  --gold: var(--accent-tertiary);
  --gold2: #b8860b;                 /* tmavsi gold variant */
  --gold-glow: var(--accent-secondary-soft);
  --emerald: var(--accent-success);
  --emerald-glow: var(--accent-success-soft);
  --coral: var(--accent-danger);
  --coral-glow: var(--accent-danger-soft);
  --azure: #2563eb;                 /* tmavsi blue */
  --azure-glow: rgba(37,99,235,.08);
  --violet: var(--accent-primary);
  --violet-glow: var(--accent-primary-soft);
  --amber: var(--accent-secondary);
  --amber-glow: var(--accent-secondary-soft);
  --teal: #0d9488;                  /* tmavsi teal */
```

---

## SOUBORY K UPRAVE

### 1. HLAVNI — App.css (jediny NUTNY soubor)

Zmenit `:root` variables dle tabulky nahore. 90% vizualni zmeny bude tady.

Dalsi veci v App.css:
- `body` — `overflow-x: hidden` zustat, barvy se pretahnou z variables
- `.header` — pridat `box-shadow: var(--shadow-card)` misto `border-bottom` (lip vypada na bilem)
- `.nav button.active` — zachovat `background: var(--accent-primary); color: #fff`
- `.logo-mark` — zachovat violet bg + white text
- Scrollbar: `.scrollbar-thumb` zmenit na `rgba(0,0,0,0.15)` hover `rgba(0,0,0,0.25)`
- Focus states: zachovat violet outline, zmenit `box-shadow` na `rgba(124,58,237,0.15)`

### 2. HLEDEJ HARDCODED BARVY — grep a opravit

Prikaz pro nalezeni vsech hardcoded dark-theme barev:
```bash
grep -rn '#07070c\|#0e0e15\|#14141e\|#1a1a26\|#1c1c28\|rgba(255,255,255' apps/dashboard/src/ --include="*.css" --include="*.jsx"
```

Typicke problemy:
- `background: #0e0e15` → zmenit na `var(--bg-surface)`
- `color: #fff` na textu → zmenit na `var(--text-primary)` (nebude vzdy bily)
- `rgba(255,255,255,0.06)` na borderech → `rgba(0,0,0,0.06)`
- `inset 0 1px 0 rgba(255,255,255,0.03)` → odstranit (white inset glow neni videt na bilem)

### 3. KREATIVNI STUDIO — CreativeStudio.jsx (inline styles!)

**POZOR:** CreativeStudio.jsx ma 900+ radku s inline styles a vlastni barvy (Neon Gold theme). Tyto konstanty navrchu souboru:

```javascript
const BG_DEEP = "#0c0c10";        // → "#ffffff"
const BG_CARD = "rgba(255,255,255,0.02)";  // → "rgba(0,0,0,0.02)"
const BG_SURFACE = "rgba(255,255,255,0.025)"; // → "rgba(0,0,0,0.03)"
const BORDER_DIM = "rgba(255,255,255,0.05)";  // → "rgba(0,0,0,0.06)"
const BORDER_DEFAULT = "rgba(255,255,255,0.07)"; // → "rgba(0,0,0,0.10)"
const TEXT_DIM = "rgba(255,255,255,0.25)";    // → "rgba(0,0,0,0.25)"
const TEXT_MID = "rgba(255,255,255,0.45)";    // → "rgba(0,0,0,0.50)"
const TEXT_BRIGHT = "rgba(255,255,255,0.7)";  // → "rgba(0,0,0,0.70)"
```

NEON/CYAN konstanty (gold accent) muzou zustat — zlata na bilem pozadi funguje dobre. Ale:
- `color: "#fff"` v inline styles → `"#1a1a2e"` nebo `var(--text-primary)` (inline styles neumoznuji CSS variables primo — bud zustat na hex hodnotach, nebo prepsat na CSS tridy)

### 4. LOGIN STRANKU — Login.css
- Dark pozadi → svetle
- Login card → bily s shadow

### 5. MODAL OVERLAYS — CreativeEditor.css, OptimizePanel.css, ImportModal.css, GeneratePanel.css
- `.ce-overlay` / `.op-overlay` — `background: rgba(0,0,0,0.3)` (misto tmave)
- `.ce-modal` / `.op-modal` — `background: #fff; border: 1px solid rgba(0,0,0,0.10)`

### 6. TOAST — Toast.css
- Toast bg: tmave toasty na svetlem pozadi vypadaji dobre. Nechat tmave NEBO zmenit na bile s border.

---

## CO NEZMENOVAT

1. **Fonty** — Michroma, Plus Jakarta Sans, Space Mono zustavaji
2. **Layout** — zadne zmeny v paddingu, gridu, spacingu
3. **Komponenty** — zadne zmeny v JSX/logice
4. **Accent barvy** — violet + gold zustavaji, jen tmavsi varianta pro kontrast na bilem
5. **Ikony a statusy** — barevne kody pro approved/rejected/pending zustavaji (jen soft bg tmavsi)

---

## POSTUP

1. **Zacit v App.css** — zmenit `:root` variables + legacy aliases
2. **Testovat** — otevrit kazdy tab, zkontrolovat ze neni neviditelny text/border
3. **Grep hardcoded** — najit a opravit hardcoded dark barvy v CSS souborech
4. **CreativeStudio.jsx** — updatovat inline konstanty
5. **Login.css** — svetly login
6. **Modaly** — overlay + modal bg
7. **Fine-tune** — shadows, hover states, scrollbar

---

## VERIFIKACE

1. Otevrit kazdy tab (Overview, Shopify, Studio, Products, Profit) — zadny bily text na bilem pozadi
2. Otevrit ProductWorkspace → Creative Studio modal — citelny text, viditelne borders
3. Login page — citelna, profesionalni
4. Store switcher dropdown — viditelny
5. Toasty — citelne
6. Optimalizace panel — citelny
7. Import modal — citelny
8. Mobile responsive — zkontrolovat ze shadows/borders funguji na mensi obrazovce
9. Scrollbar — viditelny na svetlem pozadi

---

## Copy-paste prompt pro druhy chat

```
Precti si Docs/Briefs/LIGHT-THEME.md a CLAUDE.md. Ukolem je zmenit barevne schema dashboardu z dark theme na light theme. 

Zacni v App.css — zmen :root CSS variables dle briefu. Pak grep vsechny hardcoded tmave barvy (#07070c, #0e0e15, #14141e, rgba(255,255,255,...)) a oprav je. 

DULEZITE: CreativeStudio.jsx ma inline styles s vlastnimi konstantami (BG_DEEP, BG_CARD, TEXT_DIM atd.) — updatuj je take.

Postup: App.css variables → grep hardcoded → CreativeStudio.jsx konstanty → Login.css → modaly → test.
```
