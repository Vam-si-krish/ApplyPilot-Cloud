-- Add resume_worker_secret column to the settings table (ADR 0027).
-- Lets the shared worker Bearer secret be set from the UI instead of only via the
-- RESUME_WORKER_SECRET env var. Stored server-side; the settings GET returns only a
-- masked preview, never the raw value (see app/api/settings/route.ts).
ALTER TABLE "public"."settings" ADD COLUMN IF NOT EXISTS "resume_worker_secret" TEXT;
