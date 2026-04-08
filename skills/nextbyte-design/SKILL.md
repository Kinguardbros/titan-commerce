---
name: nextbyte-design
description: >
  Nextbyte Design System — dark luxe futuristic UI design skill for the Elegance House Ads
  marketing hub and other Nextbyte projects. Use this skill whenever the user mentions
  elegancehouse-ads, nextbyte design, ads dashboard, marketing hub design, campaign UI, or asks
  to design/redesign/prototype any screen, component, or layout for Nextbyte or Elegance House
  projects. Also trigger when the user asks about design tokens, color palette, typography,
  spacing, or component patterns for these projects. This skill should be used even for small
  UI tweaks like "change the card style" or "make the sidebar look better" if it relates to
  Nextbyte or elegancehouse-ads. Always use this skill over the generic frontend-design skill
  when the context is Nextbyte or elegancehouse-ads.
---

# Nextbyte Design System — Dark Luxe Futuristic UI

This skill defines the complete visual language for **Nextbyte projects**, starting with the
elegancehouse-ads marketing hub (Next.js). It can be applied to any Nextbyte application
that needs the same futuristic dark aesthetic.

## Design Philosophy

**"Dark Luxe Tech"** — A futuristic dark interface with light content cards, inspired by premium
dashboard UIs (Nixto, Vexora). The design conveys sophistication and data clarity while feeling
modern and cutting-edge. Every screen should feel like a high-end control center for marketing
operations.

### Core Principles
1. **Fully dark, layered depth** — The entire app is dark. Cards are a slightly lighter shade
   than the page background (#14141e on #07070c), creating depth through subtle tonal shifts
   rather than light/dark contrast. Never use white or light cards.
2. **Data speaks loudly** — Big numbers, clear hierarchy, sparklines in cards. Data is the hero.
3. **Accent with intent** — Purple for primary actions and branding, amber/orange for alerts and
   highlights, yellow-gold for success and money metrics.
4. **Breathing room** — Generous spacing, never cramped. Cards have large border-radius and
   subtle shadows.
5. **Motion with purpose** — Smooth transitions on card hover, staggered page load animations,
   subtle pulse on live data. No gratuitous animation.

---

## Design Tokens

Before generating any UI, read the full design token reference:
→ `references/design-tokens.md`

### Quick Reference (use CSS variables from tokens file)

**Background layers:**
- `--bg-app`: #07070c (deepest dark — app/page background)
- `--bg-surface`: #0e0e15 (sidebar, top bar, elevated chrome)
- `--bg-card`: #14141e (content cards — slightly lighter than app bg)
- `--bg-card-hover`: #1a1a26 (card hover state)
- `--bg-card-elevated`: #1c1c28 (charts, modals, popovers — one step lighter)

**Accent palette:**
- `--accent-primary`: #8b5cf6 (purple — primary actions, active states, branding)
- `--accent-primary-soft`: #8b5cf620 (purple with transparency — hover backgrounds)
- `--accent-secondary`: #f59e0b (amber — highlights, warnings, attention)
- `--accent-tertiary`: #eab308 (gold — revenue, money, success metrics)
- `--accent-danger`: #ef4444 (red — errors, negative trends)
- `--accent-success`: #22c55e (green — positive trends, active status)

**Text:**
- `--text-primary`: #f1f1f4 (headings, key values)
- `--text-secondary`: #a1a1aa (body, labels, descriptions)
- `--text-muted`: #52525b (disabled, hints, timestamps)

**Special:**
- `--text-accent`: #8b5cf6 (links, active labels)

**Border & Effects:**
- `--border-subtle`: rgba(255, 255, 255, 0.06) (card borders, dividers)
- `--border-default`: rgba(255, 255, 255, 0.08) (inputs, stronger dividers)
- `--border-hover`: rgba(139, 92, 246, 0.2) (card hover border — purple tint)
- `--glow-purple`: 0 0 20px #8b5cf640 (purple glow for focused/active elements)
- `--glow-amber`: 0 0 20px #f59e0b40 (amber glow for alerts)

---

## Typography

**Font stack:**
- **Display/Headings**: `'Michroma', sans-serif` (weight 400 only — Michroma has single weight)
  - Rendered as **gradient text**: `background: linear-gradient(135deg, #a78bfa 0%, #f59e0b 100%)`
    with `-webkit-background-clip: text` and `-webkit-text-fill-color: transparent`
  - Always `text-transform: uppercase` with `letter-spacing: 0.1em`
  - Import: `https://fonts.googleapis.com/css2?family=Michroma&display=swap`
- **Body/UI**: `'Plus Jakarta Sans', sans-serif` (weight 400, 500, 600, 700)
  - Import: `https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap`
- **Monospace (data/numbers)**: `'Space Mono', monospace` (weight 400, 700)
  - Import: `https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap`

**Scale:**
- Page title: 14–16px / Michroma / gradient / uppercase / letter-spacing 0.1em
- Section heading: 11–12px / Michroma / gradient / uppercase / letter-spacing 0.1em
- Card title/label: 9px / Michroma / uppercase / letter-spacing 0.1em / color --text-secondary
- Body: 13–14px / Plus Jakarta Sans / weight 400–500
- Big stat number: 26–28px / Space Mono / weight 700 / letter-spacing -0.02em
- Trend/metric: 11px / Space Mono / weight 400
- Caption: 10–11px / Plus Jakarta Sans / color --text-muted

---

## Layout System

### App Shell
```
┌──────────────────────────────────────────────────┐
│  Top Bar (--bg-surface, h: 64px)                 │
├────────┬─────────────────────────────────────────┤
│        │                                         │
│ Side-  │  Page Content (--bg-app)                │
│ bar    │                                         │
│ 72px   │  ┌─────────┐ ┌─────────┐ ┌──────────┐  │
│ icons  │  │  Card    │ │  Card   │ │  Card    │  │
│ only   │  │  (light) │ │  (light)│ │  (light) │  │
│        │  └─────────┘ └─────────┘ └──────────┘  │
│ --bg-  │                                         │
│ surface│  ┌──────────────────┐ ┌──────────────┐  │
│        │  │  Chart Card      │ │  List Card   │  │
│        │  │  (dark variant)  │ │  (light)     │  │
│        │  └──────────────────┘ └──────────────┘  │
├────────┴─────────────────────────────────────────┤
```

### Grid
- Page content padding: 24px
- Card gap: 16px
- Card border-radius: 16px
- Card padding: 24px
- Card shadow: `0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03)`
- Card hover shadow: `0 4px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)`

### Sidebar (Icon Rail)
- Width: 72px
- Background: `--bg-surface`
- Icons: 24px, color `--text-secondary-dark`, active: `--accent-primary`
- Active indicator: 4px left border in `--accent-primary` or pill background `--accent-primary-soft`
- Tooltip on hover with label

### Top Bar
- Height: 64px
- Background: `--bg-surface`
- Left: App logo + breadcrumb
- Right: Search (ghost input), notifications bell, user avatar
- Bottom border: 1px `--border-subtle`

---

## Component Patterns

### Stat Card
```
┌─────────────────────────────────┐  bg: --bg-card (#14141e)
│  ● Label            ···        │  border: 1px rgba(255,255,255,0.06)
│                                 │  border-radius: 16px
│  $58,450           ↑ 12.4%     │  stat: JetBrains Mono 28px, --text-primary
│  vs last month                  │  trend: green/red + arrow
│                    ╱╲╱╲         │  hover: bg --bg-card-hover, border purple tint
└─────────────────────────────────┘
```

### Chart Card
```
┌─────────────────────────────────┐  bg: --bg-card (#14141e)
│  Statistics     Days Weeks Mo   │  border: 1px rgba(255,255,255,0.06)
│                                 │  border-radius: 16px
│      ╱╲    ╱╲                   │  chart lines: --accent-primary
│  ╱╲╱  ╲╱╲╱  ╲╱╲               │  grid lines: rgba(255,255,255,0.04)
│  7am   10am   1pm   4pm        │  bars: accent-primary at 25% + 100% opacity
└─────────────────────────────────┘
```

### Campaign Card
```
┌─────────────────────────────────┐  bg: --bg-card (#14141e)
│  ◉ Facebook    👤👤👤    Draft  │  platform icon + avatars
│                                 │  status badge (pill, semi-transparent bg)
│  Campaign Title Here            │  title: 13px/500, --text-primary
│  Meta · $2,400 spent            │  subtitle: 11px, --text-muted
│  ████████░░░░░░░░ 45%          │  progress bar: --accent-primary
└─────────────────────────────────┘
```

### Gradient Highlight Card
Use sparingly for premium CTAs or key actions:
```
┌─────────────────────────────────┐
│  background: linear-gradient(   │
│    135deg,                      │
│    rgba(139,92,246,0.25) 0%,    │  Subtle purple → amber gradient
│    rgba(245,158,11,0.2) 100%   │  (transparent, not solid)
│  )                              │
│  border: 1px solid              │
│    rgba(139,92,246,0.25)        │  Purple-tinted border
│  Launch New Campaign            │  --text-primary heading
│  Create your next ad campaign   │  --text-secondary body
│                    [+ New]      │  Solid purple button
└─────────────────────────────────┘
```

### Navigation Pills / Tabs
- Inactive: transparent bg, `--text-secondary-dark`
- Active: `--accent-primary` bg, white text
- Border-radius: 9999px (full pill)
- Padding: 8px 16px
- Transition: 200ms ease

### Buttons
- **Primary**: bg `--accent-primary`, white text, border-radius 12px, padding 10px 20px
  - Hover: brightness(1.1) + subtle glow
- **Secondary**: bg transparent, border 1px `--border-subtle`, `--text-primary-dark`
  - Hover: bg `--accent-primary-soft`
- **Ghost**: no border, `--text-secondary-dark`
  - Hover: bg `#ffffff08`
- **Danger**: bg `--accent-danger`, white text

### Data Tags / Badges
- Positive trend: bg `#22c55e20`, text `#22c55e`, "↑ 12.4%"
- Negative trend: bg `#ef444420`, text `#ef4444`, "↓ 4%"
- Neutral: bg `#71717a20`, text `#71717a`
- Status badges: Draft (gray), Active (green), Paused (amber), Ended (muted)

---

## Micro-interactions & Motion

### Page Load
- Cards fade in with stagger: `opacity 0→1, translateY 12px→0`
- Duration: 400ms per card, stagger: 80ms delay between cards
- Easing: `cubic-bezier(0.25, 0.46, 0.45, 0.94)`

### Card Hover
- Light cards: `translateY(-2px)`, shadow increases slightly
- Dark cards: border color brightens to `--accent-primary` at 30% opacity
- Duration: 200ms

### Stat Number Count-up
- On page load, big numbers animate from 0 to value
- Duration: 800ms, easing: ease-out

### Sidebar Icon Hover
- Scale 1 → 1.1, color transition to `--accent-primary`
- Tooltip slides in from left with 150ms delay

### Charts
- Lines draw in from left on load (stroke-dasharray animation)
- Data points pulse once on hover

---

## Screen Templates

When asked to design a specific screen, follow these templates:

### Dashboard (Home)
- 4× stat cards in top row (Revenue, Ad Spend, ROAS, Conversions)
- 1× large chart card (dark variant) spanning 2/3 width — campaign performance over time
- 1× campaign summary card (light) — 1/3 width
- 1× recent campaigns table/list (light card, full width)
- Gradient highlight card for key CTA ("Launch New Campaign")

### Campaigns
- Filter bar at top (platform pills, date range, status dropdown)
- Kanban-style columns OR table view toggle
- Campaign cards in columns (Draft → Active → Completed)
- Floating "+ New Campaign" button, primary style

### Analytics
- Date range selector + comparison toggle
- 2× large chart cards (dark) — impressions + CTR over time
- 4× stat cards — total spend, CPC, CPM, conversion rate
- Breakdown table (light card) — by platform, by audience, by creative

### Creatives
- Grid of creative previews (image/video thumbnails)
- Each with performance overlay (CTR, spend)
- Filter by platform, format, status
- Upload/create new CTA

### Settings
- Sectioned form layout in light cards
- Connected accounts, billing, team, notifications
- Each section in its own card

---

## Responsive Design

The app is **mobile-first responsive**. Dark mode only, no light mode toggle.

### Breakpoints
- **Mobile**: < 768px
- **Tablet**: 768px – 1023px
- **Desktop**: ≥ 1024px

### App Shell — Mobile (< 768px)
```
┌──────────────────────────────────┐
│  Top Bar (h: 56px)               │
│  Logo left · Search + Avatar     │
├──────────────────────────────────┤
│                                  │
│  Page Content (--bg-app)         │
│  Full-width, padding: 16px      │
│                                  │
│  ┌──────────────────────────┐    │
│  │  Card (full width)       │    │
│  └──────────────────────────┘    │
│  ┌──────────────────────────┐    │
│  │  Card (full width)       │    │
│  └──────────────────────────┘    │
│                                  │
├──────────────────────────────────┤
│  Bottom Tab Bar (h: 64px)        │
│  5 icons · active = gradient dot │
│  --bg-surface · border-top       │
└──────────────────────────────────┘
```

### App Shell — Tablet (768px – 1023px)
- Sidebar collapses to 56px icon rail (no tooltips, tap to navigate)
- Top bar stays at 64px
- Content padding: 20px
- Stat cards: 2×2 grid instead of 4×1
- Charts: stack vertically (full width each)
- Kanban: horizontal scroll with snap

### App Shell — Desktop (≥ 1024px)
- Full 72px sidebar with tooltips on hover
- All grids at full column count (4×1 stats, 2-col charts, 3-col kanban)

### Component Responsive Rules

**Stat Cards:**
- Desktop: `grid-template-columns: repeat(4, 1fr)`
- Tablet: `repeat(2, 1fr)`
- Mobile: `repeat(2, 1fr)` with smaller padding (14px) and font (22px numbers)

**Chart Cards:**
- Desktop: 2-col grid
- Tablet + Mobile: stack vertically, full width

**Kanban (Campaigns):**
- Desktop: 3-col grid
- Tablet: horizontal scroll with `scroll-snap-type: x mandatory`, each column `min-width: 300px`
- Mobile: single column, tabs for Draft/Active/Completed instead of columns

**Creative Grid:**
- Desktop: `repeat(3, 1fr)`
- Tablet: `repeat(2, 1fr)`
- Mobile: `repeat(1, 1fr)`

**Settings:**
- Desktop: side nav (190px) + content
- Tablet + Mobile: top tabs replacing side nav, content full width below

**Tables:**
- Desktop: full table
- Mobile: hide less important columns, or convert to stacked card layout

**Bottom Tab Bar (mobile only):**
- Height: 64px + safe area (env(safe-area-inset-bottom))
- Background: `--bg-surface`
- Border-top: 1px `--border-subtle`
- 5 icons centered, 24px each
- Active: icon color `--accent-primary` + 4px gradient dot below (purple→amber)
- Inactive: `--text-muted`
- Touch target: minimum 44×44px

**Top Bar — Mobile:**
- Height: 56px
- Left: Logo (28px) + page title (GH at 11px)
- Right: notification bell + avatar (28px)
- Search moves to expandable overlay on tap

### Touch Targets
- Minimum touch target: 44×44px on all interactive elements
- Cards: full card is tappable on mobile
- Buttons: minimum height 44px, padding 12px 20px on mobile
- Pills/tabs: minimum 36px height

### Mobile-specific Adjustments
- Card border-radius: 14px (slightly smaller)
- Card padding: 16px (from 24px)
- Card gap: 12px (from 16px)
- Page padding: 16px (from 24px)
- Heading font sizes scale down ~80% on mobile
- Stat numbers: 22px (from 28px)
- Disable hover effects — replace with active/pressed states (scale 0.98, 100ms)
- Swipe gestures on kanban and creative cards

---

## Component States

Every component must handle these states consistently:

### Loading States

**Skeleton Loader** — used for initial page/card load:
- Background: `--bg-card` (#14141e)
- Animated shimmer: `linear-gradient(90deg, #14141e 0%, #1e1e2a 50%, #14141e 100%)`
- `background-size: 200% 100%`, `animation: shimmer 1.5s ease infinite`
- Shape matches the component it replaces (rounded rects for text, circles for avatars)
- Skeleton elements have border-radius matching their real counterparts

**Stat Card Skeleton:**
```
┌─────────────────────────────────┐
│  ████████  (label, h:10, w:60%) │
│                                 │
│  ██████████████  (number, h:28) │
│  ██████  (trend, h:10, w:40%)  │
└─────────────────────────────────┘
```

**Chart Skeleton:**
- Card with heading skeleton + empty chart area with 3 pulsing horizontal lines

**Table Skeleton:**
- Header row skeleton + 4 rows of alternating-width blocks

**Spinner** — used for in-place actions (button click, save):
- 16px circle, 2px border `--accent-primary`, border-top transparent
- `animation: spin 0.6s linear infinite`
- Replaces button text during loading, button stays same width
- Button gets `opacity: 0.7`, `pointer-events: none` during loading

### Empty States

Centered in the card/area, vertical stack:

```
┌─────────────────────────────────────┐
│                                     │
│           [icon, 48px,              │
│            --text-muted]            │
│                                     │
│     No campaigns yet                │  Michroma 12px gradient
│     Create your first campaign      │  Plus Jakarta 13px --text-muted
│     to start tracking performance   │
│                                     │
│        [+ New Campaign]             │  Primary button
│                                     │
└─────────────────────────────────────┘
```

**Per-screen empty states:**
- Dashboard: "No data yet — connect your ad platforms to get started"
- Campaigns: "No campaigns yet — create your first campaign"
- Analytics: "No analytics data — run a campaign to see performance"
- Creatives: "No creatives uploaded — upload your first creative asset"
- Settings/Team: "Just you for now — invite team members to collaborate"

**Empty table:** Replace table body with centered empty message, keep headers visible

### Error States

**API Error Card:**
```
┌─────────────────────────────────────┐
│  ⚠ border-left: 3px --accent-danger│
│                                     │
│  Something went wrong               │  Plus Jakarta 14px/600
│  Could not load campaign data.      │  Plus Jakarta 13px --text-muted
│  Please try again.                  │
│                                     │
│  [Retry]  [Contact Support]         │  Primary + Ghost buttons
└─────────────────────────────────────┘
```
- Card has `border-left: 3px solid --accent-danger`
- Icon: warning triangle in `--accent-danger`
- Background stays `--bg-card` (no red background)

**Inline Field Error:**
- Input border: `--accent-danger` (1px)
- Error text below: 11px, `--accent-danger`, Plus Jakarta Sans
- Subtle red glow: `0 0 12px rgba(239, 68, 68, 0.15)` on input

**Toast Notifications:**
- Position: bottom-right, 24px from edges (desktop) / bottom-center on mobile
- Width: 360px (desktop) / calc(100% - 32px) on mobile
- Background: `--bg-card-elevated` (#1c1c28)
- Border: 1px `--border-default`
- Border-radius: 12px
- Left accent: 3px solid bar (green=success, red=error, amber=warning, purple=info)
- Auto-dismiss: 5s, slide-out to right
- Close button: ghost X icon, top-right

**Types:**
- Success: green left bar, "✓ Campaign published successfully"
- Error: red left bar, "✗ Failed to save changes"
- Warning: amber left bar, "⚠ Budget limit approaching"
- Info: purple left bar, "ℹ New platform connected"

### Disabled States
- Opacity: 0.4
- `pointer-events: none`, `cursor: not-allowed`
- No hover effects
- Buttons: keep same background but at 40% opacity

### Focus States (Accessibility)
- Visible focus ring: `box-shadow: 0 0 0 2px --bg-app, 0 0 0 4px --accent-primary`
- Applied to all interactive elements on keyboard focus (`:focus-visible`)
- Never remove focus outline without replacement

### Confirmation Dialogs (Destructive Actions)
- Modal overlay: `--bg-overlay` (rgba(7,7,12,0.6))
- Modal card: `--bg-card-elevated`, max-width 420px, border-radius 16px, padding 24px
- Title: Michroma gradient, 14px
- Body: Plus Jakarta 13px, --text-secondary
- Actions: right-aligned, [Cancel: ghost] + [Delete: danger button]
- Backdrop click or Escape to dismiss

---

## Implementation Notes

### For React/Next.js (JSX artifacts)
- Use Tailwind utility classes mapped to CSS variables
- Import fonts in component head or via `<link>` tag
- Use `recharts` for charts in React artifacts
- Use `lucide-react` for icons
- Component structure: page wrapper (dark bg) → content grid → cards

### For HTML artifacts
- Inline `<style>` with CSS variables at `:root`
- Use CSS Grid for layouts
- Inline SVG for sparklines and simple charts
- Google Fonts via `<link>` in head

### Anti-patterns (NEVER do these)
- ❌ White or light cards — all cards must be dark (#14141e or similar)
- ❌ White/light page background — everything is dark
- ❌ Generic sans-serif (Inter, Roboto, Arial) — use Plus Jakarta Sans
- ❌ Flat cards without border-radius — minimum 16px radius
- ❌ Rainbow color explosion — stick to purple + amber + supporting greens/reds
- ❌ Dense, cramped layouts — maintain generous padding and gaps
- ❌ Generic dashboard templates — every element should feel custom and intentional
- ❌ Overly bright neon colors — accents should be rich and refined, not garish
- ❌ Solid opaque gradients on CTA cards — use transparent/overlay gradients instead
- ❌ High contrast borders — borders are barely visible (rgba white at 6-8%)
