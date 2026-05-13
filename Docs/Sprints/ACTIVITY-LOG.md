# Activity Log

Chronologický záznam plánovaných a hotovových úloh / briefů / specs napříč projektem. Nejnovější nahoře.

---

## 2026-05-13

### Brief: V3 Beach Background Presets (sjednocené pozadí)

- **Soubor:** `Docs/Sprints/DEV-BRIEF-V3-BEACH-PRESETS.md`
- **Status:** Příprava / brief — není zatím k implementaci
- **Téma:** Pro Product Catalog v3 (double pipeline) přepsat step 2 z Ideogram replace-background (text → variabilní pozadí každou generaci) na Nano Banana sandwich `[master_bg, studio_shot, master_bg]` s fixní master plážovou fotkou v DB. Konzistentní pozadí napříč generacemi, thumbnail náhledy ve Studiu, admin tlačítko "Generate beach presets" per-store.
- **Cílový stav:** Každý store má 4 master pláže (sunny / golden / dune / cove) uložené v `v3_beach_presets` tabulce + Supabase Storage, ve Studiu thumbnaily pod každou Beach scene pilou, step 2 deterministicky složí studiovku z kroku 1 na ten master.
- **Nedotčeno:** v1, v2, Realistic Beach, PhotoStory, stávající `processCatalogImage` post-process — všechno funguje dál.
- **Riziko:** Nano Banana sandwich pro composite "pozadí × subjekt" neověřený (funguje pro avatar × produkt) — fallback FLUX.2 edit nebo zachovat Ideogram. Detaily v briefu §"Riziková místa".
