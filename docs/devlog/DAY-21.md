# DAY 21 — 2026-07-15 (Settings information architecture)

## Audit

- Settings rendered every unrelated control in one long page, making subscription login,
  job search, API keys, scheduling, and advanced controls difficult to locate.
- Desktop had no category navigation, while mobile required scrolling through the same
  full page.
- The visible daily run-time control did not change Netlify's timer. Prefilter and
  overnight-tailoring explanations also described behavior that had since changed.

## Implementation

- Added ADR 0082 and grouped Settings into Job Search, Automation, AI & Models,
  Connections & Keys, and Advanced. Only the active category renders.
- Added desktop category cards, a compact mobile selector, URL-hash deep links, category
  summaries, contextual save behavior, and plain-language field hints.
- Added a direct Candidate Profile handoff from AI & Models for résumé facts, candidate
  answers, avoidance preferences, and scoring/tailoring guidance.
- Hid the non-functional discovery-time input while preserving its schema compatibility,
  and corrected Netlify scheduling, ATS prefilter, overnight tailoring, API-key isolation,
  and managed-worker explanations.

## Verification

- Authenticated desktop Job Search and AI & Models screenshots plus a mobile Connections
  & Keys screenshot were inspected for hierarchy, responsive behavior, and readability.
- Full gates passed: 195 app tests (9 credentialed eval runs skipped), 11 worker tests,
  TypeScript typecheck, production build, and documentation checks (113 Markdown files,
  76 ADRs).
- Implementation commit `6df3b76` was pushed to `multi-user-fork`; the managed worker
  restarted successfully and both local and public `/version` reported that commit.
