# ADR 0104: Opt-in AI Apply and assessment calendar

- Status: accepted
- Date: 2026-07-16
- Amends: ADR 0012 Gmail AI inbox; ADRs 0093–0096 AI Apply queue; ADR 0083 candidate tailoring controls

## Context

AI Apply controls compete with the primary manual tailoring flow even for users who do
not use browser automation. The Jobs screen also exposes an internal prefilter state as a
top-level tab. Assessment emails need a calendar, but Gmail snippets often omit the
availability window or deadline. A candidate may also explicitly want a tailored copy to
display the target job's listed location without changing their Base résumé.

## Decision

- `settings.ai_apply_enabled` defaults false. Tailor & Apply hides AI assignment controls
  and the lifecycle/MCP queue rejects new work while disabled. Settings is the only opt-in.
- Queue remains Tailor & Apply's default view. The duplicate manual queue-drain control
  and the Jobs `Filtered` tab are removed; internal prefilter accounting remains intact.
- `candidate_preferences.use_job_location_on_tailored_resume` defaults false. When
  enabled, both direct and worker tailoring replace only the generated copy's header
  location with the job row location. The Base résumé remains unchanged.
- Gmail classification may read up to 12,000 characters of a message body transiently.
  The body is never persisted. For assessment mail, the classifier emits grounded ISO
  start/end timestamps; invalid, reversed, non-assessment, and invented dates are dropped.
  Only timestamps and the existing message reference are stored and shown in a new
  user-scoped Assessment Calendar.

## Consequences

AI Apply becomes deliberate rather than ambient. Calendar completeness is better than
snippet-only classification with a bounded privacy expansion: full message text reaches
the selected classifier provider during sync but does not enter PostgreSQL. Previously
classified assessment emails are not retroactively dated until reclassified.

## Verification

Test classifier date parsing, candidate preference normalization, app and worker
tailoring parity, server gating, migration constraints/RLS, production build, and live
production health after backup and migration.
