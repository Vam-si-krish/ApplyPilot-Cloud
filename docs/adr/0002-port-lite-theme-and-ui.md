# ADR 0002 — Port the ApplyPilot-Lite theme and pages, don't redesign
**Status:** accepted · **Date:** 2026-06-17
## Context
ApplyPilot-Lite has an established dark "void/sky" theme (Syne/Outfit/Fira Code fonts,
navy backgrounds, sky/emerald/amber/rose accents) and working pages (Dashboard, Jobs,
Profile, Settings). The brief says to port these, not invent new ones.
## Decision
Copy the Tailwind theme tokens and global CSS verbatim from
`ApplyPilot-Lite/ui/tailwind.config.js` + `index.css` into `tailwind.config.ts` +
`app/globals.css`. Recreate Dashboard / Jobs / Profile / Settings matching the existing
component style. Reading the corresponding Lite page is required before building each page.
## Alternatives considered
- **Fresh design system** — rejected: wastes the existing, liked design and risks drift
  from the brief.
- **Reuse Lite's exact React components 1:1** — rejected: Lite is Vite SPA with its own API
  contract and `react-router`; Next App Router + Supabase data shape differ enough that a
  faithful re-port is cleaner than forcing the old components in.
