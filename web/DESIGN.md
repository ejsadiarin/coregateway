# Design System: CORE Gateway Dashboard

> Single source of truth for `web/` agents. Read this before touching `src/app.css`, `src/components/`, or `src/pages/dashboard/`.
> Design read: **operational cockpit dashboard for a homelab owner, elegant-architectural language + futuristic status-window HUD overlay, built with Tailwind v4 + Radix + motion/react.**
> Dials: `VARIANCE 6 / MOTION 5 / DENSITY 8` — structured, functional motion, cockpit-dense.

## 1. Visual Theme & Atmosphere

Restrained architecture studio meets live status window. Deep-blue abyss canvas, hairline telemetry dividers, mono micro-labels, one glowing signal color. Calm at rest, alive on change.

Dense like Cloudflare, crisp like Valorant HUD, warm-craft restraint like Claude — but **no beige, no serif dashboards, no neon slop**. Keep current deep blue.

Signature moments (use sparingly, max 1 per view):
- HUD corner brackets on entrance portal + service-detail modal only.
- Floating terminal card pattern (Image-2 style): mono query line + big tabular number + micro bar/spark + progress hairline.
- Tracking pill (Image-1 style): bottom-center `● Tracking X — click empty or Esc to release`.

Density 8 = cockpit. Data breathes in plain layout with 1px dividers, not boxed cards everywhere.

## 2. Color Palette & Roles

Locked. One brand accent. Statuses are functional, not brand.

- **Abyss** (#0A0E1A) — app background. Never pure black.
- **Panel Deep** (#0F172A) — popover, dropdown, raised surface.
- **Card Veil** (rgba(15,23,42,0.60)) — card fill. Always pair with inner top highlight, never outer glow.
- **Ink Foam** (#E0F2F1) — primary text.
- **Muted Slate** (#94A3B8) — secondary text, timestamps, metadata.
- **Whisper Line** (rgba(0,229,204,0.14)) — 1px hairlines, card borders, dividers. Was 0.20, drop to 0.14 for restraint.
- **Signal Teal** (#00E5CC) — SOLE brand accent. CTAs, active nav, focus rings, live dots. `text-primary / bg-primary / border-primary` map here.
- **Input Wash** (rgba(30,41,59,0.50)) — input fill.

Functional status only (never for CTAs/marketing):
- **Online Emerald** (#10B981) — online, success.
- **Degraded Amber** (#F59E0B) — degraded, warning. Replaces `yellow-500`.
- **Offline Red** (#EF4444) — offline, destructive.
- **Maintenance Indigo** (#6366F1) — maintenance, info.
- **Unknown Slate** (#64748B) — unknown, muted.

Charts reuse: `#00E5CC, #10B981, #6366F1, #A855F7, #EC4899` in that order. No new hues without review.

Banned: pure `#000000` / `#FFFFFF`, AI purple-blue gradient washes, teal outer glows (`glow-box`, `glow-text`), warm beige `#FAFAF9` in dashboard surfaces.

## 3. Typography Rules

- **Display:** `Space Grotesk` — track-tight (`tracking-tighter leading-none`), `text-2xl md:text-4xl` max for dashboard headers. Weight-driven hierarchy, not scale. Add via `@fontsource/space-grotesk`, self-hosted, `font-display: swap`. No Google `<link>` in prod.
- **Body:** `Space Grotesk` 400/500 — `leading-relaxed`, `max-w-[65ch]`, `text-sm/base`, color Muted Slate on secondary, Ink Foam on primary.
- **Mono / Data:** `JetBrains Mono` (already loaded) — ALL micro-labels, breadcrumbs, metrics, timestamps, table numbers. Uppercase + `tracking-[0.18em]-[0.3em]` + `text-[10px]-xs`. ALL numbers `tabular-nums`.
- **Banned:** Inter as display default, generic serif in dashboard (`Georgia`, `Playfair`, `Times`). Serif allowed in exactly one place: entrance-portal marketing moment (Image-2 "United States" pattern) — never in app surfaces.
- **Scale discipline:** dashboard H1 max 2 lines. Hero/welcome strip: headline + ≤20-word sub + stats — no full-page centered hero in app.

## 4. Component Stylings

- **Buttons:** flat, no `glow-box`. `rounded-lg` (8px). Primary = Signal fill + Abyss text. Secondary = ghost/outline Whisper Line. Tactile `active:scale-[0.98]` + `-translate-y-[1px]`. Labels 1-2 words, single line at desktop, 44px min target. Valorant corner-cut (`clip-path` 8-10px cut) ONLY on primary HUD actions — not global.
- **Cards:** `rounded-xl` (12px). `bg-card/60 backdrop-blur-sm` allowed on fixed header only, not scrolling lists. Inner highlight `shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]`, hairline `border-border`. No outer neon shadow. High-density rule: if a metric can live as a divider row, don't box it. ServiceCard keeps box (hierarchy) minus shimmer-gradient + bottom rainbow line — replace with 2px Signal top-tick on hover/focus.
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
