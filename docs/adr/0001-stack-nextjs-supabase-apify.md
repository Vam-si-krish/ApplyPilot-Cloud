# ADR 0001 — Next.js + Supabase + Apify on Vercel
**Status:** accepted · **Date:** 2026-06-17
## Context
We need a self-running, cloud-hosted rewrite of ApplyPilot-Lite's fetch+score flow.
The whole point of the rewrite is to stop depending on a local machine for scraping.
## Decision
Next.js (App Router) on Vercel for UI + API in one deploy; Supabase Postgres for storage;
Apify for job fetching; an LLM API for scoring (Gemini default); Vercel Cron for scheduling.
TypeScript everywhere. This stack was specified by the project brief and is the lowest-friction
fully-serverless option.
## Alternatives considered
- **Keep Python/FastAPI, host on a VM/container** — rejected: reintroduces an always-on
  server to manage; the brief explicitly wants serverless + the React/Next ecosystem.
- **Supabase Edge Functions instead of Next API routes** — rejected: splitting logic across
  Deno functions + a separate frontend host adds deploy complexity; Next keeps it one repo/deploy.
- **Firebase** — rejected: brief specifies Supabase; Postgres + SQL migrations fit the relational data.
