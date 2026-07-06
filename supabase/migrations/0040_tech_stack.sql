-- Tech stack captured by the scorer (ADR 0065).
-- The company assessment (company_tier/company_tier_note, added in 0007) is now
-- produced inline by the fit scorer instead of a separate LLM pass, and the same
-- call also names the role's primary technologies so "a React company" is visible
-- at a glance. Stored as a text[] of technology names (e.g. {React,TypeScript}).
-- Run this in the Supabase SQL editor, or via `supabase db push`.

alter table jobs add column if not exists tech_stack text[];
