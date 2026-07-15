# ADR 0097: Owner production profile transfer to development

- Status: accepted
- Date: 2026-07-15
- Amends: ADRs 0089 and 0091

## Context

Development intentionally began empty, and ADR 0091 allowed only synthetic fixtures and
an explicit copy of the owner's API-key rows. After the AI Apply plugin foundation was
built, the owner explicitly requested their real production résumé, Candidate Profile
details, and some real production applications in the `vamsi` development account so the
complete workflow can be tested realistically.

Copying the whole database or another fixed account remains unnecessary and unsafe. The
existing backend APIs can perform a bounded owner-only transfer without exposing a
database administrator password or adding a production/development synchronization path.

## Decision

- Permit one explicit, repeatable transfer from the isolated fork production backend
  (`/jobpilot`) to the development backend (`/jobpilot-dev`) for only the fixed `vamsi`
  UUID.
- Copy Candidate Profile fields, saved application answers, the structured Base résumé,
  and the available original résumé PDF. Do not copy settings, credentials, API keys,
  mail, Gmail/OAuth state, subscription sessions, runs, fixed-login secrets, or another
  account.
- Copy at most twelve recent unapplied applications with usable web links, prioritizing
  rows that already contain a tailored résumé and PDF. Copy their job data, structured
  tailored résumé, cover-letter text, and available résumé/cover PDFs.
- Production remains read-only. Both environments are backed up before execution. The
  script uses each backend's existing service API with an explicit `vamsi` identity; it
  does not connect directly to PostgreSQL.
- Remove production run/duplicate relationships and reset clicked, applied, parked, and
  AI Apply state in development. Nothing is automatically assigned, opened, or submitted.
- Store copied files under the development-only `imports/production/` namespace, verify
  their hashes after upload, and clear a file reference when its production object is
  already unavailable.
- This remains a deliberate one-time test-data action, not ongoing synchronization.
  Development now contains real personal data and must retain the same private access and
  backup controls as production.

## Consequences

- The `vamsi` development account can test Candidate Profile, résumé generation/download,
  real application rows, autofill fallback, and the ApplyPilot plugin with representative
  data.
- The source is unchanged and Pilot 2/Pilot 3 remain untouched in both environments.
- Rerunning the script updates the bounded imported set idempotently, subject to its UUID
  and URL collision mapping; it never expands the scope past the requested limit.

## Verification

- Test owner rejection, linked/unapplied selection, bounded count, field allowlists,
  relationship removal, and reset operational state.
- Dry-run first and report only counts, never profile values, job titles, or file bytes.
- After execution, verify the target profile UUID, Base résumé presence, application
  ownership/count, reset AI/applied state, and every copied file hash.
