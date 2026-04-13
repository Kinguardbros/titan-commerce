# DEV BRIEF — Creative Detail Modal (Trybe Light Design)

> **Projekt:** Titan Commerce (multi-store SaaS dashboard)
> **Datum:** 2026-04-13
> **Prerekvizita:** Přečti si `CLAUDE.md` — kompletní architektura, konvence, pravidla.
> **Design reference:** `Design/creativestudio_photo/creative-detail-modal.jsx` + `Design/creativestudio_photo/CREATIVE-STUDIO-HANDOFF.md`

---

## Kontext

Máme design pro nový Creative Detail Modal — light theme (Trybe style, purple `#6C47FF`) jako read-only preview s akcemi. Nahradí stávající `CreativeEditor.jsx` (302 řádků) při zobrazení detailu kreativy.

**Jde ČISTĚ o design — žádný pohyb s funkcemi.** Stávající funkce (approve, reject, download, convert to video) zůstávají, jen se přebalí do nového UI.

---

## Design soubor

`Design/creativestudio_photo/creative-detail-modal.jsx` (367 řádků) — kompletní JSX se sample daty. Obsahuje:

### Layout
- **Levá strana (48%):** Obrázek (cover), status badge LT, A/B badge RT, aspect ratio + resolution badge LB
- **Pravá strana:** Fixed header (export dropdown + close) → scrollable body (generation config, negative prompt, tags) → fixed footer (approve/reject + generate dropdown)

### Design systém (Trybe Light)
- **Background:** `#FFFFFF` (modal), `#F5F4FA` (surface)
- **Accent:** `#6C47FF` (purple)
- **Status:** Green (approved), Amber (pending), Red (rejected)
- **Fonty:** General Sans (body) + JetBrains Mono (mono/data)
- **Border radius:** 24px modal, 14px karty, 100px pills/badges, 12px buttons

### Komponenty z designu
- `MetricCard` — stat box (label + value)
- `DetailRow` — key-value řádek v config tabulce
- `DropdownBtn` — button s dropdown menu (Export nahoře, Generate dole)
- `SectionHead` — sekce label (uppercase mono)

### Akce (onAction callback)
- `approve` / `reject` — hlavní CTA ve footeru
- `download` / `push-shopify` / `push-meta` / `copy-url` — Export dropdown
- `regenerate` / `convert-video` / `regenerate-variant` — Generate dropdown

---

## Co udělat

### 1. Vytvořit `components/CreativeDetailModal.jsx` + CSS

Vzít design z `Design/creativestudio_photo/creative-detail-modal.jsx` a:
- Odstranit `SAMPLE` data (ř. 28-55) — data přijdou z props
- Přesunout inline styles do `CreativeDetailModal.css` (dodržet 300 řádků limit na JSX)
- Zachovat font `<link>` tagy (General Sans + JetBrains Mono) — nebo je přidat do `index.html`
- Exportovat jako `export default function CreativeDetailModal({ data, onClose, onAction })`

### 2. Napojit na existující data flow

Stávající `CreativeEditor.jsx` se otevírá v `Studio.jsx` a `ProductWorkspace.jsx` přes `editingCreative` state. Nový modal potřebuje stejná data — mapovat existující creative objekt na props:

```js
// Existující creative objekt z DB:
{ id, product_id, store_id, style, type, format, file_url, status, hook_used, headline, created_at, aspect_ratio, show_model }

// Mapování na nový modal props:
{
  product: creative.product_title || 'Unknown',
  imageUrl: creative.file_url,
  status: creative.status,  // 'pending' | 'approved' | 'rejected'
  variant: `v${creative.variant || 1}`,
  style: creative.style,
  format: creative.format || 'image',
  aspectRatio: creative.aspect_ratio || '1:1',
  resolution: aspectRatioToResolution(creative.aspect_ratio),
  created: new Date(creative.created_at).toLocaleString(),
  model: creative.metadata?.model || 'Nano Banana 2',
  provider: creative.metadata?.provider || 'fal.ai',
  pose: creative.hook_used || '',  // repurposed field
  scene: creative.metadata?.scene || '',
  subject: creative.show_model ? 'On model' : 'Product only',
  tags: creative.metadata?.tags || [],
}
```

### 3. Napojit akce na existující API

Stávající `CreativeEditor.jsx` volá:
- `approveAd(creative.id)` → approve
- `rejectAd(creative.id)` → reject
- Download → `window.open(creative.file_url)`
- Convert to video → `convertToVideo(creative.id)`

Nový `onAction` handler:
```js
const handleAction = (actionId) => {
  switch (actionId) {
    case 'approve': approveAd(creative.id).then(refresh); break;
    case 'reject': rejectAd(creative.id).then(refresh); break;
    case 'download': window.open(creative.file_url, '_blank'); break;
    case 'convert-video': convertToVideo(creative.id).then(refresh); break;
    case 'regenerate': /* TODO: regenerate endpoint */; break;
    case 'push-shopify': /* TODO: future */; break;
    case 'push-meta': /* TODO: future */; break;
    case 'copy-url': navigator.clipboard.writeText(creative.file_url); toast.success('URL copied'); break;
  }
};
```

### 4. Integrace do Studio.jsx a ProductWorkspace.jsx

Nahradit `CreativeEditor` za `CreativeDetailModal` v obou stránkách:

```jsx
// Místo:
{editingCreative && <CreativeEditor creative={editingCreative} onClose={...} />}

// Nové:
{editingCreative && <CreativeDetailModal data={mapCreativeToModalData(editingCreative)} onClose={...} onAction={handleAction} />}
```

### 5. Stávající CreativeEditor.jsx

**NESMAZAT** hned — ponechat jako fallback. Až nový modal funguje, `CreativeEditor.jsx` přesunout do `_archive/` nebo smazat.

---

## Soubory

| Soubor | Akce | Řádků |
|--------|------|-------|
| `components/CreativeDetailModal.jsx` | Nový | ~200 |
| `components/CreativeDetailModal.css` | Nový | ~150 |
| `pages/Studio.jsx` | Upravit — import + render nového modalu | ~10 |
| `pages/ProductWorkspace.jsx` | Upravit — import + render nového modalu | ~10 |
| `components/CreativeEditor.jsx` | Ponechat (fallback), později smazat | — |

---

## Pořadí práce

1. Vytvořit `CreativeDetailModal.jsx` z designu — extrahovat inline styles do CSS
2. Vytvořit mapper funkci `mapCreativeToModalData(creative)`
3. Napojit `onAction` na existující API funkce
4. Integrace do `Studio.jsx`
5. Integrace do `ProductWorkspace.jsx`
6. Test: otevřít detail kreativy, approve, reject, download, convert to video
7. Ověřit build

---

## Definition of Done

- [ ] Klik na kreativu otevře nový modal (Trybe light design, purple accent)
- [ ] Obrázek vlevo (48%), detaily vpravo (scrollable)
- [ ] Status badge (Approved/Pending/Rejected) na obrázku i v headeru
- [ ] Export dropdown funguje (Download, Copy URL)
- [ ] Approve/Reject funguje a aktualizuje status
- [ ] Convert to video funguje
- [ ] Generation config tabulka zobrazuje data z kreativy
- [ ] Tags zobrazeny jako purple pills
- [ ] Modal se zavře na ✕ nebo klik mimo
- [ ] Stávající `CreativeEditor.jsx` není smazán (fallback)
- [ ] `npm run build` projde
- [ ] `npm test` projde

---

## Pravidla

- Max 300 řádků per soubor — JSX + CSS separátně
- Inline styles z designu extrahovat do CSS
- `catch (e) {}` zakázáno
- Fonty (General Sans, JetBrains Mono) přidat do `index.html` nebo ponechat v komponentě
- **Žádné funkční změny** — jen nový design wrapper kolem existujících akcí
