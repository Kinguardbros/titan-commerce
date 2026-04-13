# DEV BRIEF — Avatar Studio: Persona Reference Images + Custom Model Generation

> **Projekt:** Titan Commerce
> **Datum:** 2026-04-13
> **Prerekvizita:** `CLAUDE.md`, `Docs/Sprints/DEV-BRIEF-STORY-REFERENCE.md` (reference_url pattern)
> **Závislost:** Story reference feature (hero → reference_url) musí být hotová první

---

## Kontext

AI generátory nemají memory mezi requesty — každý shot produkuje jinou ženu. Photo Story reference (hero → reference_url) řeší konzistenci UVNITŘ jedné story, ale ne NAPŘÍČ story/produkty.

**Avatar Studio** řeší: každá audience persona má persistentní "tvář" — referenční fotku uloženou v DB. Při generování čehokoli (Studio, Photo Story, GeneratePanel) se persona reference automaticky injektuje jako reference image.

### Co to odemyká
- **Konzistence napříč produkty** — Maria vypadá stejně na bikinách i na šatech
- **Škála modelek** — vygeneruj 5 variant Marie (různé pózy/výrazy), vyber nejlepší jako anchor
- **Custom modelky** — nevyhovuje AI-generovaná Maria? Vygeneruj novou na míru z popisu
- **Visual picker** — při výběru audience vidíš tvář, ne jen jméno

---

## Architektura

### Nová tabulka `persona_avatars`

```sql
CREATE TABLE IF NOT EXISTS persona_avatars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) NOT NULL,
  persona_name TEXT NOT NULL,           -- "Maria", "Jennifer", "Diane"
  label TEXT,                           -- "The Hiding Mom"
  age INTEGER,                          -- 42
  description TEXT,                     -- body type, vzhled, emoce z audience-personas skillu
  reference_url TEXT,                   -- URL vybrané referenční fotky (anchor)
  variants JSONB DEFAULT '[]',          -- [{url, prompt, created_at}] — všechny vygenerované varianty
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(store_id, persona_name)
);
```

### Data flow

```
Avatar Studio
  ├── Zobrazí persony z audience-personas skillu
  ├── Pro každou: referenční fotka (pokud existuje) nebo placeholder
  │
  ├── [Generate Avatar] → Claude generuje prompt z persona popisu
  │   → fal.ai generuje 4 varianty (portrait, headshot style)
  │   → User vybere nejlepší → uloží jako reference_url
  │
  ├── [Custom Avatar] → User popíše modelku textem
  │   → fal.ai generuje varianty → user vybere
  │
  └── Reference URL se automaticky používá:
      ├── Studio (CreativeStudio) — audience picker ukazuje thumbnail
      ├── GeneratePanel — audience picker ukazuje thumbnail
      ├── Photo Story — reference_url per persona
      └── api/creatives/generate.js — pokud audience vybraná, načte reference_url z DB
```

---

## Implementace

### 1. SQL migrace (~15 řádků)

```sql
CREATE TABLE IF NOT EXISTS persona_avatars (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id UUID REFERENCES stores(id) NOT NULL,
  persona_name TEXT NOT NULL,
  label TEXT,
  age INTEGER,
  description TEXT,
  reference_url TEXT,
  variants JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(store_id, persona_name)
);
CREATE INDEX IF NOT EXISTS idx_persona_avatars_store ON persona_avatars(store_id);
ALTER TABLE persona_avatars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_persona_avatars" ON persona_avatars FOR ALL TO authenticated USING (true);
```

### 2. Backend — 4 nové akce v `lib/actions/` (nový modul `avatars.js`, ~150 řádků)

| Akce | Metoda | Popis |
|------|--------|-------|
| `persona_avatars` | GET | Seznam avatarů pro store (s reference_url) |
| `generate_avatar` | POST | Generuje 4 varianty z persona popisu → vrátí URLs |
| `set_avatar_reference` | POST | Nastaví vybranou variantu jako reference_url |
| `delete_avatar` | POST | Smaže avatar |

**`generate_avatar` flow:**
1. Načte persona popis z `audience-personas` skillu (nebo z `persona_avatars.description`)
2. Sestaví prompt: "Portrait headshot of [persona description]. Neutral studio background, soft lighting, shoulders and face visible, natural expression."
3. Generuje 4 varianty přes fal.ai (Flux Kontext — nejlepší pro konzistentní portréty)
4. Uloží URLs do `persona_avatars.variants` JSONB
5. Vrátí URLs pro výběr

**`set_avatar_reference` flow:**
1. Nastaví vybranou URL jako `reference_url`
2. Uloží do Supabase Storage pro persistence (fal.ai URLs expirují)

### 3. Frontend — Avatar Studio UI (~250 řádků)

Nový komponent `components/AvatarStudio.jsx` — modal nebo sekce ve Studiu.

```
┌─────────────────────────────────────────────┐
│  Avatar Studio                         ✕    │
│  Manage model references per persona        │
│                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐    │
│  │  [foto]  │  │  [foto]  │  │  [ ? ]  │    │
│  │  Maria   │  │ Jennifer │  │  Diane  │    │
│  │  42      │  │  35      │  │  55     │    │
│  │ Hiding   │  │ Defeated │  │Invisible│    │
│  │   Mom    │  │Researcher│  │  Woman  │    │
│  │          │  │          │  │         │    │
│  │[Generate]│  │[Generate]│  │[Generate│    │
│  └─────────┘  └─────────┘  └─────────┘    │
│                                             │
│  ── Po Generate: ────────────────────────   │
│                                             │
│  4 varianty:                                │
│  [var1] [var2] [var3] [var4]               │
│  Klik = vyber jako reference               │
│                                             │
│  [+ Custom Avatar]  — popsat modelku textem │
└─────────────────────────────────────────────┘
```

### 4. Frontend — Persona picker s thumbnaily

Ve všech místech kde se vybírá audience (CreativeStudio, GeneratePanel, PhotoStoryModal) — přidat thumbnail vedle jména:

**CreativeStudio.jsx** (audience dropdown ~ř. 668):
```jsx
// Místo:
<option value={p.name}>{p.name} ({p.age}) — {p.label}</option>

// Nové:
<div className="persona-option">
  <img src={p.reference_url} className="persona-thumb" />
  <span>{p.name} ({p.age}) — {p.label}</span>
</div>
```

Potřebuje custom select komponent (ne native `<select>`) pro thumbnaily.

### 5. Backend — Auto-inject persona reference do generování

V `api/creatives/generate.js` — pokud `audience` je vybraná a `reference_url` NENÍ explicitně poslaná:

```js
// Po destructuringu req.body:
if (audience && !reference_url) {
  const { data: avatar } = await supabase.from('persona_avatars')
    .select('reference_url')
    .eq('store_id', store_id)
    .eq('persona_name', audience)
    .eq('is_active', true)
    .single();
  if (avatar?.reference_url) {
    reference_url = avatar.reference_url;
  }
}
```

Tím se persona reference automaticky přidá ke KAŽDÉ generaci kde je audience vybraná — Studio, Photo Story, GeneratePanel. Zero změn ve frontendu potřeba.

### 6. Router update — `api/system.js`

Přidat importy a akce do GET_ACTIONS / POST_ACTIONS mapy.

---

## Soubory

| Soubor | Typ | Řádků |
|--------|-----|-------|
| `sql/add-persona-avatars.sql` | Nový | ~15 |
| `lib/actions/avatars.js` | Nový modul | ~150 |
| `api/system.js` | Update router | ~5 |
| `components/AvatarStudio.jsx` + CSS | Nový | ~250 + ~80 |
| `api/creatives/generate.js` | Auto-inject reference | ~10 |
| `components/CreativeStudio.jsx` | Persona picker thumbnaily | ~20 |
| `components/PhotoStoryModal.jsx` | Persona picker thumbnaily | ~15 |
| `lib/api.js` | Nové API funkce | ~20 |

---

## Pořadí práce

1. **SQL migrace** — `persona_avatars` tabulka
2. **`lib/actions/avatars.js`** — backend akce
3. **`api/system.js`** — router update
4. **`lib/api.js`** — API funkce (getAvatars, generateAvatar, setAvatarReference)
5. **`AvatarStudio.jsx` + CSS** — UI pro generování a správu
6. **`api/creatives/generate.js`** — auto-inject persona reference
7. **`CreativeStudio.jsx`** — persona picker s thumbnaily
8. **`PhotoStoryModal.jsx`** — persona picker s thumbnaily
9. **Integrace do Studia** — tlačítko "Avatar Studio" nebo sekce
10. **Test** — vygenerovat avatar pro Marii → generovat kreativu s audience Maria → ověřit konzistenci

---

## Definition of Done

- [ ] Avatar Studio UI: zobrazí persony s fotkami (nebo placeholder)
- [ ] Generate Avatar: 4 varianty z persona popisu, user vybere
- [ ] Vybraná varianta uložena jako `reference_url` v `persona_avatars`
- [ ] Persona picker (Studio, GeneratePanel, PhotoStory) ukazuje thumbnail
- [ ] Generování s audience = automaticky injektuje persona reference_url
- [ ] Custom Avatar: user popíše modelku → generuje varianty
- [ ] Konzistence: Maria vypadá stejně na různých produktech
- [ ] `npm run build` + `npm test` projde
- [ ] CLAUDE.md aktualizovaný

---

## Pravidla

- `lib/higgsfield.js` — NEDOTÝKAT SE
- `agents/scraper.md` — NEDOTÝKAT SE
- Persona reference images uložit do Supabase Storage (fal.ai URLs expirují)
- Max 300 řádků per soubor
- Avatar generování: portrait/headshot styl, ne full body (pro reference konzistenci tváře)

---

## Rizika

- **fal.ai URL expiry:** Vygenerované obrázky mají temporary URL. Po výběru reference musíme stáhnout a uložit do Supabase Storage (trvalé URL).
- **Konzistence limity:** I s reference image AI může měnit detaily (účes, make-up). Flux Kontext je nejlepší pro identity preservation, Nano Banana méně přesný.
- **Custom select:** Native `<select>` nepodporuje thumbnaily. Potřeba custom dropdown komponent — CreativeStudio už má `Select` komponent, ověřit jestli podporuje renderOption s obrázky.
