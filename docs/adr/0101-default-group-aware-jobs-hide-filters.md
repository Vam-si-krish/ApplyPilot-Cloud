# ADR 0101: Default, group-aware Jobs hide filters

- Status: accepted
- Date: 2026-07-16
- Amends: ADR 0078
- Relates to: ADR 0057

## Context

Jobs collapses duplicate postings and locations beneath a canonical row. The existing
“Hide in Tailor & Apply” implementation excluded application job UUIDs before grouping.
When the excluded UUID was the canonical row, every otherwise-visible duplicate beneath
it disappeared too. This made roughly 50 tailored canonical jobs capable of emptying a
view backed by more than 160 individual postings. “Hide applied” had the same canonical
row failure mode. Combining a long UUID `NOT IN` list with a second duplicate-group UUID
list could also exceed the gateway request limit, turning the API response into an empty
UI list.

ADR 0078 removed every default hide rule while recovering fresh unscored jobs from
unrelated score, company, and run constraints. The owner now prefers completed work to
stay out of the working list by default, provided the hide rules do not suppress eligible
duplicate locations.

## Decision

- Enable “Hide applied” and “Hide in Tailor & Apply” on the initial Jobs-page load.
- Keep “Clear all” literal: it disables both hide rules along with every other visible
  constraint.
- Apply both rules to each posting UUID, including duplicate-location rows attached to a
  grouped result.
- Resolve Tailor & Apply membership separately and apply exact UUID exclusions to bounded
  result sets; do not compose repeated unbounded UUID lists into the PostgREST URL.
- When a hidden canonical row still has eligible duplicates, promote one eligible
  duplicate as the group representative and attach the other eligible locations beneath
  it. Do not hide the entire group merely because its original canonical row is hidden.
- Preserve the explicit Applied tab: its status selection continues to disable the
  “Hide applied” constraint.

## Consequences

- The default Jobs list focuses on unprocessed, unapplied work without losing eligible
  duplicate locations.
- Raw posting totals and grouped visible-row totals may still differ by design, but a
  hidden canonical no longer turns that difference into an empty working list.
- Users can expose completed/tailored rows at any time by unchecking either filter or
  using Clear all.

## Verification

- Test default checkbox state and query-parameter emission.
- Test promotion of a visible duplicate when its canonical is hidden.
- Test that tailored and applied duplicate locations are removed from sibling lists.
- Run the frontend suite, TypeScript, production build, and documentation validation.
