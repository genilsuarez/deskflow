# DeskFlow — Agent Guide

## What is it

Portal/dashboard that connects all Learn Platform apps into a unified experience.
Static site — HTML + CSS + vanilla JS. No build step.

## Stack

- HTML5 + CSS3 + Vanilla JS (ES modules)
- No build step — serve directly (works from file:// or any HTTP server)
- Google Fonts: Newsreader (display) + Manrope (UI) + JetBrains Mono (code)
- Design tokens: `--lp-*` prefix (Learn Platform) — shared with FluentFlow, HubFlow, LyricFlow

## Structure

```
index.html           — Entry point / portal dashboard
styles.css           — All styles (design tokens + components)
lp-theme.js          — Theme init (copy of scripts/lp-theme.js)
lp-platform-urls.js  — Cross-app URLs (copy of scripts/)
lp-nav-icons.js      — Sidebar icon SVGs (copy of scripts/)
lp-nav-active.css    — Active nav item styles (copy of scripts/)
lp-login.js          — Login modal + bindNavButton (copy of scripts/)
lp-guest-reset.js    — Guest/logout cross-tab (copy of scripts/)
lp-about.js          — About LearnFlow modal (copy of scripts/)
lp-about.css         — About modal styles (copy of scripts/)
lp-auth-setup.js     — Supabase auth wiring (copy of scripts/)
lp-supabase.js       — Supabase client (copy of scripts/)
lp-progress-summary.js — Progress summary helpers (copy of scripts/)
sync-engine.js       — Cloud sync base (copy of scripts/)
sync-engine-audit.js — DeskFlow-only repair/audit helpers
app.js               — Portal logic, navigation, views
progress-reader.js   — Reads learnflow:progress:* from localStorage
scripts/             — Scripts (QA, audits, utilities)
scripts/tmp/         — Temporary scripts (gitignored)
AGENTS.md            — This file
```

## Serve in development

```bash
npx serve . -p 3000
# or
python3 -m http.server 3000
```

## Script execution rules

- **ALL scripts** must live in `scripts/` (or `scripts/tmp/` for one-offs)
- NEVER execute inline JS/Python in the terminal
- `scripts/tmp/` is gitignored — use for audits, QA, temporary analysis
- Execute with: `node scripts/<name>.js` or `node scripts/tmp/<name>.js`
- Allowed direct commands: `npx serve`, `python3 -m http.server`, `git`, simple shell utils

## Design conventions

- Warm editorial theme (paper texture, terracotta accent)
- CSS custom properties in `:root` with `--lp-` prefix
- Typography: Newsreader for display, Manrope for UI, JetBrains Mono for badges
- Dark mode via `[data-theme="dark"]`
- Mobile-first responsive
- BEM naming for CSS classes

## Topbar — Dynamic Content System

The topbar updates its content dynamically based on the active view via `updateTopbar(viewName)` in `app.js`.

### Behavior

- Views with `eyebrow` (actividad, continuar) apply `.topbar--compact` (16px padding) to fit 3 lines without growing taller than the default.
- Views without eyebrow (resumen, module details) keep the default 22px padding with 2 lines (title + sub).
- Content map lives in `TOPBAR_CONTENT` object in `app.js`.

### Key rule

Do NOT add `page-header` elements inside `view-actividad` or `view-continuar` — their header content is rendered in the shared topbar. The `.page-header` CSS class is **deprecated and removed** — do not reintroduce it.

## Auth, login, and cloud sync

- Login modal: `lp-login.js` — use `lpLogin.bindNavButton('#loginTrigger', …)` in `app.js`
- Auth session: `lp-auth-setup.js` → imports `sync-engine.js`
- Cloud sync base: `sync-engine.js` (canonical in `Learn/scripts/`)
- DeskFlow audit/repair only: `sync-engine-audit.js` (`repairLocalProjections`, `auditLocalProjections`, `auditCloudAlignment`)
- About modal: `lpAbout.open()` from `lp-about.js` (not inline in `app.js`)

## Connected apps

| App | Repo | URL |
|-----|------|-----|
| FluentFlow | genilsuarez/fluentflow | https://genilsuarez.github.io/fluentflow/ |
| HubFlow | genilsuarez/hubflow | https://genilsuarez.github.io/hubflow/ |
| LyricFlow | genilsuarez/lyricflow | https://genilsuarez.github.io/lyricflow/ |
