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
index.html      — Entry point / portal dashboard
styles.css      — All styles (design tokens + components)
scripts/        — Scripts (QA, audits, utilities)
scripts/tmp/    — Temporary scripts (gitignored)
AGENTS.md       — This file
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

## Connected apps

| App | Repo | URL |
|-----|------|-----|
| FluentFlow | genilsuarez/fluentflow | https://genilsuarez.github.io/fluentflow/ |
| HubFlow | genilsuarez/hubflow | https://genilsuarez.github.io/hubflow/ |
| LyricFlow | genilsuarez/lyricflow | https://genilsuarez.github.io/lyricflow/ |
