# LearnDesk — Agent Guide

## What is it

Portal/dashboard that connects all Learn Platform apps into a unified experience.
Static site — HTML + CSS + vanilla JS. No build step.

## Stack

- HTML5 + CSS3 + Vanilla JS (ES modules)
- No build step — serve directly (works from file:// or any HTTP server)
- Google Fonts: Newsreader (display) + Manrope (UI) + JetBrains Mono (code)
- Design tokens: `--lp-*` prefix (Learn Platform) — shared with FluentFlow, LearnHub, LyricFlow

## Structure

```
index.html      — Entry point / portal dashboard
styles.css      — All styles (design tokens + components)
AGENTS.md       — This file
```

## Serve in development

```bash
npx serve . -p 3000
# or
python3 -m http.server 3000
```

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
| LearnHub | genilsuarez/learnhub | https://genilsuarez.github.io/learnhub/ |
| LyricFlow | genilsuarez/lyricflow | https://genilsuarez.github.io/lyricflow/ |
