-- Per-generation token usage (ADR 0064). Written by the worker after each tailor
-- call: { input_tokens, output_tokens, cache_read_input_tokens,
-- cache_creation_input_tokens, cost_usd?, model, ms }. Lets the user see what one
-- résumé costs against the subscription window and whether the prompt cache is
-- actually being read (cache_read > 0 after the caching fix).
alter table applications add column if not exists tailor_usage jsonb;
