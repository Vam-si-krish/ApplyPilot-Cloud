-- Single-flight scoring session + progress (ADR 0028).
-- One row (id=1) acts as a mutex so only ONE chunked-scoring chain runs at a time
-- (previously concurrent self-triggering chains — multi-portal webhooks, the manual
-- "Score unscored" button, overlapping runs — could read the same 'unscored' rows
-- and score them 2–3×). It also carries live progress (total/done) and a
-- stop_requested flag so the UI can show a progress bar and stop mid-run without
-- losing already-scored work.
CREATE TABLE IF NOT EXISTS public.scoring_state (
  id               int PRIMARY KEY DEFAULT 1,
  active           boolean NOT NULL DEFAULT false,
  stop_requested   boolean NOT NULL DEFAULT false,
  rescan_requested boolean NOT NULL DEFAULT false,
  token            text,
  total            int NOT NULL DEFAULT 0,
  done             int NOT NULL DEFAULT 0,
  errors           int NOT NULL DEFAULT 0,
  started_at       timestamptz,
  heartbeat        timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scoring_state_singleton CHECK (id = 1)
);

INSERT INTO public.scoring_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
