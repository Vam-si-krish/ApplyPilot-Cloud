-- 0039: "Set Aside" parking area in Tailor & Apply (ADR 0061).
-- parked=true moves an application to the Set Aside tab: it keeps all its state
-- (résumé, PDF, status) but leaves the working Queue and is skipped by the
-- overnight tailoring drain until moved back.
ALTER TABLE applications ADD COLUMN IF NOT EXISTS parked boolean NOT NULL DEFAULT false;
