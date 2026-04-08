# Nextbyte Design System — Design Tokens Reference

Complete design token specification for Nextbyte projects (elegancehouse-ads and others).
This file contains every CSS variable, spacing value, and visual constant.

## CSS Variables (copy-paste ready)

```css
:root {
  /* ══════════════════════════════════════════
     BACKGROUND LAYERS
     ══════════════════════════════════════════ */
  --bg-app: #07070c;              /* Deepest dark — main page background */
  --bg-surface: #0e0e15;          /* Sidebar, top bar, elevated chrome */
  --bg-surface-hover: #14141e;    /* Surface hover state */
  --bg-card: #14141e;             /* Content cards — slightly lighter than app */
  --bg-card-hover: #1a1a26;       /* Card hover */
  --bg-card-elevated: #1c1c28;    /* Charts, modals, popovers */
  --bg-overlay: #07070c99;        /* Modal/dialog overlay */
  --bg-input: #0e0e15;            /* Input fields */
  --bg-input-focus: #14141e;      /* Input focus state */

  /* ══════════════════════════════════════════
     ACCENT PALETTE
     ══════════════════════════════════════════ */
  /* Primary — Purple (actions, branding, active states) */
  --accent-primary: #8b5cf6;
  --accent-primary-hover: #7c3aed;
  --accent-primary-soft: rgba(139, 92, 246, 0.12);
  --accent-primary-glow: 0 0 20px rgba(139, 92, 246, 0.25);

  /* Secondary — Amber (highlights, warnings, attention) */
  --accent-secondary: #f59e0b;
  --accent-secondary-hover: #d97706;
  --accent-secondary-soft: rgba(245, 158, 11, 0.12);
  --accent-secondary-glow: 0 0 20px rgba(245, 158, 11, 0.25);

  /* Tertiary — Gold (revenue, money metrics, premium) */
  --accent-tertiary: #eab308;
  --accent-tertiary-soft: rgba(234, 179, 8, 0.12);

  /* Semantic */
  --accent-success: #22c55e;
  --accent-success-soft: rgba(34, 197, 94, 0.12);
  --accent-danger: #ef4444;
  --accent-danger-soft: rgba(239, 68, 68, 0.12);
  --accent-info: #3b82f6;
  --accent-info-soft: rgba(59, 130, 246, 0.12);

  /* Gradient — use sparingly for highlight cards and premium CTAs */
  --gradient-primary: linear-gradient(135deg, #8b5cf6 0%, #f59e0b 100%);
  --gradient-primary-subtle: linear-gradient(135deg, rgba(139,92,246,0.2) 0%, rgba(245,158,11,0.2) 100%);
  --gradient-card: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 50%, #f59e0b 100%);

  /* ══════════════════════════════════════════
     TEXT COLORS
     ══════════════════════════════════════════ */
  --text-primary: #f1f1f4;        /* Headings, key values */
  --text-secondary: #a1a1aa;      /* Body, labels, descriptions */
  --text-muted: #52525b;          /* Disabled, hints, timestamps */
  --text-disabled: #3f3f46;       /* Fully disabled elements */

  /* Special */
  --text-accent: #8b5cf6;
  --text-link: #8b5cf6;
  --text-link-hover: #a78bfa;

  /* ══════════════════════════════════════════
     BORDERS & DIVIDERS
     ══════════════════════════════════════════ */
  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-default: rgba(255, 255, 255, 0.08);
  --border-strong: rgba(255, 255, 255, 0.15);
  --border-hover: rgba(139, 92, 246, 0.2);
  --border-input: rgba(255, 255, 255, 0.08);
  --border-input-focus: #8b5cf6;
  --border-accent: #8b5cf6;

  /* ══════════════════════════════════════════
     SHADOWS
     ══════════════════════════════════════════ */
  --shadow-card: 0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.03);
  --shadow-card-hover: 0 4px 16px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05);
  --shadow-dropdown: 0 8px 30px rgba(0,0,0,0.5);
  --shadow-modal: 0 16px 48px rgba(0,0,0,0.6);

  /* ══════════════════════════════════════════
     SPACING SCALE
     ══════════════════════════════════════════ */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  /* Layout-specific */
  --sidebar-width: 72px;
  --topbar-height: 64px;
  --page-padding: 24px;
  --card-gap: 16px;
  --card-padding: 24px;
  --card-radius: 16px;
  --card-radius-sm: 12px;
  --card-radius-lg: 20px;
  --pill-radius: 9999px;
  --input-radius: 10px;
  --button-radius: 12px;

  /* ══════════════════════════════════════════
     TYPOGRAPHY
     ══════════════════════════════════════════ */
  --font-display: 'Michroma', sans-serif;
  --font-body: 'Plus Jakarta Sans', sans-serif;
  --font-mono: 'Space Mono', monospace;

  /* Font sizes */
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 14px;
  --text-md: 16px;
  --text-lg: 18px;
  --text-xl: 20px;
  --text-2xl: 24px;
  --text-3xl: 28px;
  --text-4xl: 36px;
  --text-5xl: 48px;

  /* Line heights */
  --leading-tight: 1.2;
  --leading-normal: 1.5;
  --leading-relaxed: 1.6;

  /* ══════════════════════════════════════════
     TRANSITIONS
     ══════════════════════════════════════════ */
  --transition-fast: 150ms ease;
  --transition-base: 200ms ease;
  --transition-slow: 300ms ease;
  --transition-spring: 400ms cubic-bezier(0.25, 0.46, 0.45, 0.94);

  /* ══════════════════════════════════════════
     Z-INDEX SCALE
     ══════════════════════════════════════════ */
  --z-base: 0;
  --z-card: 1;
  --z-sticky: 10;
  --z-sidebar: 20;
  --z-topbar: 30;
  --z-dropdown: 40;
  --z-modal: 50;
  --z-toast: 60;
}
```

## Font Import Tags

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Michroma&family=Space+Mono:wght@400;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```

## Tailwind CSS Mapping

If using Tailwind, extend the config with these tokens:

```js
// tailwind.config.js extend colors
colors: {
  app: { DEFAULT: '#07070c', surface: '#0e0e15' },
  card: { DEFAULT: '#14141e', hover: '#1a1a26', elevated: '#1c1c28' },
  purple: { DEFAULT: '#8b5cf6', hover: '#7c3aed', soft: 'rgba(139,92,246,0.12)' },
  amber: { DEFAULT: '#f59e0b', hover: '#d97706', soft: 'rgba(245,158,11,0.12)' },
  gold: { DEFAULT: '#eab308' },
}
```

## Platform Icon Colors

When displaying platform-specific elements:
- **Facebook/Meta**: #1877F2
- **Google Ads**: #4285F4 (blue), #34A853 (green), #FBBC05 (yellow), #EA4335 (red)
- **Instagram**: gradient(#833AB4, #FD1D1D, #F77737)
- **TikTok**: #000000 with accent #EE1D52
- **Pinterest**: #E60023
- **Snapchat**: #FFFC00

Use these only for platform icons/badges, not as part of the main UI palette.

## Chart Color Sequences

For multi-series charts, use this ordered palette:
1. `#8b5cf6` (purple — primary series)
2. `#f59e0b` (amber — secondary series)
3. `#22c55e` (green — tertiary)
4. `#3b82f6` (blue — quaternary)
5. `#ef4444` (red — quinary)
6. `#a78bfa` (light purple — sixth)

For single-series: use `--accent-primary` with `--accent-primary-soft` for area fill.

## Responsive Breakpoints

```css
--bp-sm: 640px;   /* Mobile landscape */
--bp-md: 768px;   /* Tablet */
--bp-lg: 1024px;  /* Desktop */
--bp-xl: 1280px;  /* Wide desktop */
--bp-2xl: 1536px; /* Ultra-wide */
```

### Mobile Overrides (< 768px)
```css
@media (max-width: 767px) {
  :root {
    --sidebar-width: 0px;        /* Hidden — replaced by bottom tab bar */
    --topbar-height: 56px;       /* Shorter top bar */
    --page-padding: 16px;        /* Tighter padding */
    --card-gap: 12px;            /* Tighter gaps */
    --card-padding: 16px;        /* Smaller card padding */
    --card-radius: 14px;         /* Slightly smaller radius */
    --bottombar-height: 64px;    /* Bottom tab bar */
  }
}
```

### Tablet Overrides (768px – 1023px)
```css
@media (min-width: 768px) and (max-width: 1023px) {
  :root {
    --sidebar-width: 56px;       /* Compact icon rail */
    --page-padding: 20px;
    --card-gap: 14px;
  }
}
```

### Layout Rules
- Sidebar → bottom tab bar on mobile (< md)
- Stat cards: 4-col desktop → 2-col tablet/mobile
- Charts: 2-col desktop → 1-col stacked on tablet/mobile
- Kanban: 3-col desktop → horizontal scroll tablet → tabbed view mobile
- Creative grid: 3-col → 2-col → 1-col
- Touch targets: minimum 44×44px on all interactive elements
- Disable hover effects on mobile — use active/pressed states instead

## Skeleton / Shimmer Animation

```css
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton {
  background: linear-gradient(90deg, #14141e 0%, #1e1e2a 50%, #14141e 100%);
  background-size: 200% 100%;
  animation: shimmer 1.5s ease infinite;
  border-radius: var(--card-radius-sm);
}
```

## Spinner

```css
@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--accent-primary);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
```

