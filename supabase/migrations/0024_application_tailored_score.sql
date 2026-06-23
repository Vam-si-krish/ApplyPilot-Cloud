-- Fit score of the TAILORED résumé against the job (ADR 0029). Lets the Applications
-- view show all three signals side by side: the original job fit_score, the AI company
-- tier, and how the newly-tailored résumé scores — so the user can see the lift.
ALTER TABLE "public"."applications" ADD COLUMN IF NOT EXISTS "tailored_fit_score" int;
ALTER TABLE "public"."applications" ADD COLUMN IF NOT EXISTS "tailored_score_note" text;
