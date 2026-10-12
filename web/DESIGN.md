# Design System: CORE Gateway Dashboard

> Single source of truth for `web/` agents. Read this before touching `src/app.css`, `src/components/`, or `src/pages/dashboard/`.
> Design read: **operational cockpit dashboard for a homelab owner, elegant-architectural language + futuristic status-window HUD overlay, built with Tailwind v4 + Radix + motion/react.**
> Dials: `VARIANCE 6 / MOTION 5 / DENSITY 8` — structured, functional motion, cockpit-dense.

## 1. Visual Theme & Atmosphere

Restrained architecture studio meets live status window. Deep-blue abyss canvas, hairline telemetry dividers, mono micro-labels, one glowing signal color. Calm at rest, alive on change.

Dense like Cloudflare, crisp like Valorant HUD, warm-craft restraint like Ember + Claude — but **no beige surfaces, no serif dashboards, no neon slop**. Warm craft dark: espresso canvas, terracotta signal, amber highlights.

Signature moments (use sparingly, max 1 per view):
- HUD corner brackets on entrance portal + service-detail modal only.
- Floating terminal card pattern (Image-2 style): mono query line + big tabular number + micro bar/spark + progress hairline.
- Tracking pill (Image-1 style): bottom-center `● Tracking X — click empty or Esc to release`.

Density 8 = cockpit. Data breathes in plain layout with 1px dividers, not boxed cards everywhere.

## 2. Color Palette & Roles

Locked. One brand accent. Statuses are functional, not brand.

- **Espresso** (#141110) — app background. Never pure black.
- **Hearth Deep** (#1C1917) — popover, dropdown, raised surface.
- **Card Veil** (rgba(28,25,23,0.65)) — card fill. Always pair with inner top highlight, never outer glow.
- **Bone Ink** (#EAE3D8) — primary text.
- **Warm Ash** (#A8A29E) — secondary text, timestamps, metadata.
- **Whisper Line** (rgba(231,229,228,0.10)) — 1px hairlines, card borders, dividers. Warm neutral, never accent-tinted (Ember rule: terracotta is for interactive only).
- **Ember Terracotta** (#E26D4D) — SOLE brand accent. CTAs, active nav, focus rings, live dots. `text-primary / bg-primary / border-primary` map here.
- **Input Wash** (rgba(41,37,36,0.60)) — input fill.

Functional status only (never for CTAs/marketing):
- **Online Emerald** (#34D399) — online, success.
- **Degraded Amber** (#F59E0B) — degraded, warning. Replaces `yellow-500`.
- **Offline Red** (#E5484d) — offline, destructive.
- **Maintenance Tan** (#D4A373) — maintenance, info. No cool indigo in warm theme.
- **Unknown Stone** (#78716C) — unknown, muted.

Charts reuse: `#E26D4D, #34D399, #D4A373, #F59E0B, #FB7185` in that order. No new hues without review.

Banned: pure `#000000` / `#FFFFFF`, AI purple-blue gradient washes, teal/cyan anywhere (`#00E5CC`, `cyan-*`, `#020617`), neon outer glows.

## 2b. Runtime Color Schemes

Four client-side themes, one token shape. Switcher lives in the header (Palette icon), persists to `localStorage`, applies via `data-theme` on `<html>` — no re-render, CSS does the work. Logic: `src/lib/theme.ts`. Never lazy-split theme CSS (3 var blocks, ~1KB); split only if a theme gains real assets.
- **ember** (default) — palette above.
- **abyss** — refined abyss blue: `#0A0E1A` canvas, `#00E5CC` signal, `#6366F1` info.
- **paper** — warm light: `#FAFAF9` canvas, `#1C1917` ink, `#C2410C` CTAs.
- **mono** — off-black `#0E0E0E` + electric lime `#C8FF2E` pop.
- **valorant** — gunmetal `#0F1923` HUD + tactical red `#FF4655` signal, off-white nominal states, sharp `--radius: 0.25rem`.
Rules for theme-safe accents: hardcoded hexes are banned outside `theme.ts` — use `var(--chart-N)` / `color-mix(in srgb, var(--primary) …)` so every surface follows the switch. Canvas APIs (Particles) read per-theme hex from `themeMeta()`.

## 3. Typography Rules

- **Display:** `Space Grotesk` — track-tight (`tracking-tighter leading-none`), `text-2xl md:text-4xl` max for dashboard headers. Weight-driven hierarchy, not scale. Add via `@fontsource/space-grotesk`, self-hosted, `font-display: swap`. No Google `<link>` in prod.
- **Body:** `Space Grotesk` 400/500 — `leading-relaxed`, `max-w-[65ch]`, `text-sm/base`, color Muted Slate on secondary, Ink Foam on primary.
- **Mono / Data:** `JetBrains Mono` (already loaded) — ALL micro-labels, breadcrumbs, metrics, timestamps, table numbers. Uppercase + `tracking-[0.18em]-[0.3em]` + `text-[10px]-xs`. ALL numbers `tabular-nums`.
- **Banned:** Inter as display default, generic serif in dashboard (`Georgia`, `Playfair`, `Times`). Serif allowed in exactly one place: entrance-portal marketing moment (Image-2 "United States" pattern) — never in app surfaces.
- **Scale discipline:** dashboard H1 max 2 lines. Hero/welcome strip: headline + ≤20-word sub + stats — no full-page centered hero in app.

## 4. Component Stylings

- **Buttons:** flat, no `glow-box`. `rounded-lg` (8px). Primary = Signal fill + Abyss text. Secondary = ghost/outline Whisper Line. Tactile `active:scale-[0.98]` + `-translate-y-[1px]`. Labels 1-2 words, single line at desktop, 44px min target. Valorant corner-cut (`clip-path` 8-10px cut) ONLY on primary HUD actions — not global.
- **Cards:** `rounded-xl` (12px). `bg-card/60 backdrop-blur-sm` allowed on fixed header only, not scrolling lists. Inner highlight `shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]`, hairline `border-border`. No outer neon shadow. Service cards add mouse-tracking spotlight (`radial-gradient(240px … rgba(226,109,77,0.12))` via `--mx/--my` CSS vars, no re-render) + 2px Signal top-tick on hover. High-density rule: if a metric can live as a divider row, don't box it.
- **Status pills / badges:** `rounded-full`, mono `text-[10px] uppercase tracking-[0.18em]`, dot + pulse. Pattern: `● ONLINE`, `● TRACKING PED 04 — click empty or Esc`. One pulse loop per view cluster.
- **HUD brackets:** 16px L-corners `border-primary/50`, entrance + detail modal only. Not on every card.
- **Inputs:** label above, `gap-2` block, error below. Focus ring Signal. No placeholder-as-label. Contrast AA min.
- **Loaders:** skeletal blocks matching exact card dims (keep `ServiceCardSkeleton`). No circular spinners except full-page `Initializing...` boot state.
- **Empty states:** composed (icon + 1-line why + 1 CTA), not bare "No data".
- **Nav:** sidebar 240/64, hairline right border, no `backdrop-blur-xl` on scroll container. Active item = Signal left tick + tinted wash, not glow. Header = sticky, `bg-background/60 backdrop-blur-md`, breadcrumb mono, current page uppercase Ink.

## 5. Layout Principles

- Grid-first. No flex percentage math, no `calc()` column hacks. `max-w-[1400px] mx-auto`, `px-4 md:px-6 py-6`.
- Full-height = `min-h-[100dvh]`, never `h-screen` (fix `dashboard-shell.tsx`, `sidebar.tsx`). iOS Safari jump otherwise.
- Welcome gradient banner (`page.tsx`) is banned pattern — replace with slim status strip: left `DASHBOARD ONLINE + last sync`, right telemetry trio (Services / Uptime / Avg response) separated by 1px dividers, mono labels. Asymmetric, left-aligned, no center.
- No 3-equal-cards row. `SystemStatus` 2-col is correct. `ServiceGrid`: 1-col mobile, 2-col md, 3-col xl with featured-online first — never 6 identical boxes with no rhythm.
- Telemetry rails: left micro-label + right value (Image-1 pattern: `track 05 / conflicts 00 / N-S 4.4s / frame 57 fps`). Use for System Vitals footer + detail modal meta.
- Mobile: everything collapses single-column <768px. No horizontal scroll. Sidebar hidden, bottom-nav takes over. Touch targets 44px.
- z-scale only: header 30, sidebar 40, modal/overlay 50, grain 60. No arbitrary `z-[999]`.

## 6. Motion & Interaction

Engine: `motion/react` (`motion` lib already installed). Isolated `"use client"` leaf components for anything animated. No `window.scrollY` listeners, no `window.addEventListener('scroll')` — use `useScroll` / `IntersectionObserver` / `whileInView`.

- **Defaults:** `duration 0.2-0.3, ease: easeOut` for route/content fades. Spring `stiffness: 100, damping: 20` only for modal/drawer/popover. `initial={{opacity:0, y:6}}` — never `y:20`+ heavy drops on dense lists.
- **Stagger:** cascade `delay: i * 0.06` capped at 5 items, then cut. Current `0.1 * idx` unbounded is too slow.
- **Perpetual loops:** live dots + beacon pulse ONLY. Remove `glow-pulse` on text/icons, remove `scan-line` from dashboard (entrance-only, fixed `pointer-events-none` pseudo-element). Animate `transform/opacity` only — fix sidebar `width` animation (layout jank): switch to CSS `transition-[width]` or grid-template-columns, keep `motion` for opacity/x inside.
- **Sounds (Valorant tick):** WebAudio blips on hover-select / confirm / error, off by default, opt-in toggle in settings + `prefers-reduced-motion` disables. No autoplay, no external assets, <30ms sine/noise ticks.
- **A11y/perf:** honor `prefers-reduced-motion: reduce` (collapse to static). `backdrop-blur` on fixed header/sidebar only, never scrolling cards. Lazy `three/@react-three/cobe` below fold. Targets: LCP <2.5s, INP <200ms, CLS <0.1, 60fps transforms.
- **Tactile:** buttons/links push on `:active`. Focus-visible Signal ring. Skeleton shimmer via opacity/translate, not layout props.

## 7. Anti-Patterns (Banned)

- No emojis in UI. No `Inter` display default. No pure black/white.
- No `glow-text` / `glow-box` neon outer shadows. No `bg-gradient-to-r from-primary/10 via-accent/10 to-secondary/10` banner washes.
- No shimmer-sweep divs on every card hover. No scan-lines / particle fields inside dashboard.
- No centered app heroes, no "Scroll to explore", no 3-equal-cards, no eyebrow on every section (max 1 per 3 sections).
- No custom mouse cursors. No `h-screen`. No `width/height/top/left` animations.
- No duplicate CTA intents on one view. One primary CTA per view (Ember rule).
- No mixed radius (pick 8px interactive / 12px card / full pill statuses, lock it).
- No cool-gray/warm-beige fluctuation mid-page. Abyss stays Abyss.
- No AI copy clichés ("Seamless", "Unleash", "Next-Gen"). Labels are terminal-plain: `SYSTEM VITALS`, `REAL-TIME MONITORING`, `AUTHENTICATION REQUIRED`.
- No fake precision (`99.99%`) unless from API. No `picsum`/broken Unsplash in dashboard.
