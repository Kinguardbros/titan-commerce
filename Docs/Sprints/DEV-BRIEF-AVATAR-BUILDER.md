# DEV BRIEF — Avatar Builder: Custom Model Creation

> **Projekt:** Titan Commerce
> **Datum:** 2026-04-13
> **Prerekvizita:** `CLAUDE.md`, Avatar Studio (musí být deploynutý — `pages/Avatars.jsx` + `components/AvatarDetail.jsx`)

---

## Kontext

Avatar Studio aktuálně zobrazuje persony z audience-personas skillu (Maria, Jennifer, Diane). "Generate" tlačítko generuje z textového popisu persony. Chybí:

1. **"+ Create New"** — uživatel si vytvoří úplně nový avatar od nuly (jako character creator)
2. **Generate z podkladů** — vylepšit: tlačítko u existující persony přečte celý popis z DB a generuje přesněji
3. **Custom builder toolbar** — nastavitelné parametry: věk, body type, skin tone, vlasy, nedokonalosti, výraz

---

## Implementace

### 1. Nový komponent `components/AvatarBuilder.jsx` + CSS (~250 řádků)

Modal — "character creator" pro vytvoření nového avatara. Otevře se z `Avatars.jsx` přes tlačítko "+ Create New".

```
┌──────────────────────────────────────────────────────────────┐
│  Create New Avatar                                       ✕   │
│                                                              │
│  ┌─── Toolbar ───────────────────┐  ┌─── Preview ────────┐  │
│  │                               │  │                    │  │
│  │  Name: [           ]          │  │                    │  │
│  │                               │  │   [placeholder /   │  │
│  │  Age:  [ 42 ]  ← slider      │  │    generated       │  │
│  │                               │  │    preview]        │  │
│  │  Body type:                   │  │                    │  │
│  │  ○ Slim  ○ Athletic           │  │                    │  │
│  │  ● Average  ○ Curvy           │  │                    │  │
│  │  ○ Plus-size                  │  │                    │  │
│  │                               │  │                    │  │
│  │  Skin tone:                   │  │                    │  │
│  │  [■][■][■][■][■][■]          │  │                    │  │
│  │   swatches                    │  │                    │  │
│  │                               │  └────────────────────┘  │
│  │  Hair:                        │                          │
│  │  Color: [Brunette ▼]          │  Generated variants:     │
│  │  Length: [Long ▼]             │  [v1] [v2] [v3] [v4]    │
│  │  Style: [Wavy ▼]             │  Klik = vyber + preview  │
│  │                               │                          │
│  │  Imperfections:               │                          │
│  │  ☐ Stretch marks              │                          │
│  │  ☐ Cellulite                  │                          │
│  │  ☐ Scars                      │                          │
│  │  ☐ Freckles                   │                          │
│  │  ☐ Tan lines                  │                          │
│  │  ☐ Visible veins              │                          │
│  │                               │                          │
│  │  Expression:                  │                          │
│  │  ○ Confident  ● Relaxed       │                          │
│  │  ○ Smiling  ○ Serious         │                          │
│  │                               │                          │
│  │  Extra notes: [textarea]      │                          │
│  │                               │                          │
│  │  [🎲 Generate Preview]       │                          │
│  │  [💾 Save Avatar]            │                          │
│  └───────────────────────────────┘                          │
└──────────────────────────────────────────────────────────────┘
```

### Builder parametry:

| Parametr | Typ | Hodnoty |
|----------|-----|---------|
| Name | text input | Volný text (povinný) |
| Age | slider + number | 18–70, default 40 |
| Body type | radio pills | Slim, Athletic, Average, Curvy, Plus-size |
| Skin tone | color swatches | 6-8 předdef. odstínů (light ivory → deep brown) |
| Hair color | select | Blonde, Brunette, Black, Auburn, Red, Gray, White |
| Hair length | select | Short, Medium, Long, Very long |
| Hair style | select | Straight, Wavy, Curly, Coily, Pixie, Bob, Updo |
| Imperfections | checkboxes | Stretch marks, Cellulite, Scars, Freckles, Tan lines, Visible veins |
| Expression | radio pills | Confident, Relaxed, Smiling, Serious |
| Extra notes | textarea | Volný popis pro specifika |

### Prompt assembly:

Builder parametry se složí do promptu pro fal.ai:

```js
function buildAvatarPrompt(params) {
  const { age, bodyType, skinTone, hairColor, hairLength, hairStyle, imperfections, expression, extraNotes } = params;
  
  const impStr = imperfections.length > 0
    ? `Realistic body details: ${imperfections.join(', ')}. These should be subtly visible, natural, NOT exaggerated.`
    : 'Natural skin texture, no excessive retouching.';

  return `Professional headshot portrait photograph. Shoulders and face visible, neutral studio background with soft even lighting.

Model: Woman, age ${age}. Body type: ${bodyType}. Skin tone: ${skinTone}.
Hair: ${hairColor}, ${hairLength}, ${hairStyle}.
Expression: ${expression}, looking directly at camera.

${impStr}

${extraNotes ? `Additional details: ${extraNotes}` : ''}

Style: Clean beauty portrait. Natural skin texture, minimal retouching. Shot on 85mm lens, f/2.8, shallow depth of field. The focus is on creating a RECOGNIZABLE, CONSISTENT face for use across multiple product photo shoots.`;
}
```

### Generate flow:

1. User nastaví parametry v toolbar
2. Klik "Generate Preview" → volá `generateAvatar(storeId, name, promptText)` (backend)
3. 4 varianty se zobrazí v preview area
4. Klik na variantu → zobrazí velký preview
5. Klik "Save Avatar" → `set_avatar_reference()` + uloží do `persona_avatars` s description = prompt parametry jako JSON

### 2. Upravit `pages/Avatars.jsx` (~15 řádků)

Přidat "+ Create New" tlačítko:

```jsx
<div className="av-header">
  <div>
    <div className="av-title">Avatar Studio</div>
    <div className="av-subtitle">Manage model references for consistent product photos</div>
  </div>
  <button className="av-create-btn" onClick={() => setShowBuilder(true)}>+ Create New</button>
</div>

{showBuilder && (
  <AvatarBuilder storeId={storeId} onClose={() => setShowBuilder(false)} onCreated={() => { setShowBuilder(false); refresh(); }} />
)}
```

### 3. Upravit `components/AvatarDetail.jsx` (~10 řádků)

Vylepšit "Gen" tlačítko — místo jednoduchého popisu z labelu, načíst celý description z `persona_avatars` tabulky. Pokud `descText` je prázdný, načíst z audience-personas skillu:

Aktuálně ř. 43: `generateAvatar(storeId, persona.name, descText || persona.label)`

Vylepšit: pokud persona má podrobný popis v DB (z audience-personas skillu), použít ho. Frontend pošle celý popis, ne jen label.

### 4. Backend — upravit `generate_avatar` v `lib/actions/avatars.js` (~5 řádků)

Aktuálně ř. 33 — prompt je statický template. Pokud `description` obsahuje JSON (z builderu), parsovat a použít `buildAvatarPrompt()`. Pokud je to plain text (z persony), použít stávající template.

Nebo jednodušeji: frontend VŽDY sestaví prompt a backend ho jen předá fal.ai. Nový parametr: `custom_prompt` místo `description`.

### 5. Skin tone swatches — konstanty

```js
const SKIN_TONES = [
  { label: 'Light ivory', hex: '#FFE0C2' },
  { label: 'Fair beige', hex: '#F5D0A9' },
  { label: 'Medium olive', hex: '#D4A574' },
  { label: 'Warm tan', hex: '#B8804A' },
  { label: 'Deep brown', hex: '#8B5E3C' },
  { label: 'Rich dark', hex: '#5C3A21' },
];
```

---

## Soubory

| Soubor | Typ | Řádků |
|--------|-----|-------|
| `components/AvatarBuilder.jsx` + CSS | Nový — character creator modal | ~250 + ~120 |
| `pages/Avatars.jsx` | Upravit — přidat "+ Create New" button + modal | ~15 |
| `components/AvatarDetail.jsx` | Upravit — lepší prompt z persona description | ~10 |
| `lib/actions/avatars.js` | Upravit — přijímat custom_prompt | ~10 |

---

## Pořadí práce

1. `AvatarBuilder.jsx` + CSS — builder UI s toolbar a preview
2. Prompt assembly funkce (`buildAvatarPrompt`)
3. `Avatars.jsx` — "+ Create New" tlačítko + modal
4. `AvatarDetail.jsx` — vylepšit generate s plným popisem
5. `lib/actions/avatars.js` — přijímat custom_prompt
6. Test: vytvořit nový avatar s custom parametry → generovat → uložit → ověřit v persona pickeru

---

## Definition of Done

- [ ] "+ Create New" tlačítko v Avatar Studio headeru
- [ ] Builder modal s toolbar: věk (slider), body type (radio), skin tone (swatches), vlasy (3 selecty), imperfections (checkboxy), expression (radio), extra notes (textarea)
- [ ] "Generate Preview" vytvoří 4 varianty z builder parametrů
- [ ] Varianty zobrazené v preview area, klik = velký preview
- [ ] "Save Avatar" uloží vybranou variantu + popis do `persona_avatars`
- [ ] Nový avatar se objeví v Avatars gridu
- [ ] Nový avatar funguje jako audience v Studiu a Photo Story
- [ ] Existující "Gen" v AvatarDetail používá plnější prompt
- [ ] `npm run build` projde
- [ ] Max 300 řádků per soubor

---

## Pravidla

- `lib/higgsfield.js` — NEDOTÝKAT SE
- Builder prompt assembly je ve FRONTENDU (`AvatarBuilder.jsx`) — backend jen přijme a předá fal.ai
- Skin tone: používat popisné názvy v promptu, ne hex kódy (AI rozumí "warm tan" lépe než "#B8804A")
- Imperfections: "subtly visible, natural, NOT exaggerated" — realistické, ne přehnané
- Fotky: portrait/headshot styl (hlava + ramena), ne full body — pro konzistenci tváře
