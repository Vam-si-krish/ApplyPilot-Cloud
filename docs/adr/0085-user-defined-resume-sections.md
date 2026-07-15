# ADR 0085: User-defined résumé sections across every consumer

- Status: accepted
- Date: 2026-07-15
- Builds on: ADRs 0024, 0029, 0031, 0036, 0053, 0073, and 0084

## Context

The structured résumé supported only basics, work, education, skills, and projects.
Users could add another entry to those fixed sections but could not represent meaningful
headings such as Additional Experience, Certifications, Leadership, Publications, or
Awards. Storing an arbitrary heading only in the UI would be unsafe: scoring, AI
tailoring, change review, and the PDF worker would silently omit it.

The résumé is JSONB on the already user-owned `profile` and `applications` rows. This
allows an additive document-shape change without weakening forced RLS or adding a table.
The worker holds a deliberate hand-kept copy of normalization and tailoring logic, so
both process boundaries must understand the same shape.

## Decision

Extend `ResumeDoc` with an ordered `customSections` array. Each section has a user-owned
`title` and ordered generic `items`; each item may contain `name`, `description`, `date`,
`location`, `url`, and `highlights`. Generic labels keep the schema useful for many
section kinds without accepting arbitrary unvalidated nested JSON.

- The shared base/tailored editor lets users add, rename, edit, and delete sections and
  entries. The tailored change-review view renders and diffs their bullets.
- App and worker normalization accept the new shape and turn missing legacy
  `customSections` into `[]`. Base and full-application GET boundaries normalize stored
  documents before returning them.
- App and worker text serializers include every custom section, so local ATS matching,
  AI scoring, cover letters, and ApplyBuddy can use the facts.
- Onboarding parsing preserves nonstandard source-résumé headings as custom sections.
- Tailoring output includes alignment-only custom section/item identifiers and may
  rewrite only existing highlights. The merge restores titles and all item metadata from
  the base and caps highlights to the base count. Condensing follows the same rule.
- PDF templates render semantic single-column custom sections after Projects and before
  Education. The deterministic overflow backstop considers custom-entry highlights.

## Consequences

- A section added once to the Base résumé is available everywhere that consumes the
  résumé, for that user only.
- The generic item model is intentionally less specialized than a dedicated certification
  or publication schema; labels in the editor explain how to map those concepts.
- Existing rows and PDFs continue to work with no SQL migration. Saving an older résumé
  upgrades its normalized JSON shape.
- The résumé worker must be restarted after deployment. `/version` advertises
  `custom-resume-sections` so operators can verify the running worker has the new contract.
