# Current decision router

Use this index to find accepted decisions for the surface being changed. Read only the
linked ADRs relevant to the task, plus any amendment/supersession links they contain.
When adding a durable decision, add it to the appropriate row.

| Surface | Current ADRs |
|---|---|
| Product fork, isolation, fixed-user ownership, gateway/RLS | [0072](adr/0072-independent-multi-user-fork-foundation.md), [0073](adr/0073-fixed-accounts-and-enforced-user-ownership.md), [0075](adr/0075-deployment-managed-worker-boundary.md) |
| Development/production branches and guarded personal-laptop operations | [0088](adr/0088-restricted-personal-laptop-server-control.md), [0089](adr/0089-isolated-development-environment.md) |
| Authorized data-transfer exceptions | [0087](adr/0087-explicit-owner-snapshot-cutover.md), [0091](adr/0091-owner-authorized-development-seed-and-key-copy.md), [0097](adr/0097-owner-production-profile-development-transfer.md) |
| Apify discovery, callbacks, key ownership, and deduplication | [0004](adr/0004-decouple-fetch-and-score.md), [0005](adr/0005-configurable-apify-actor.md), [0076](adr/0076-free-tier-linkedin-actor-default.md), [0077](adr/0077-pin-apify-callback-url-and-run-key.md) |
| Scoring contract, caching, company assessment, and result completeness | [0022](adr/0022-scoring-v2-rubric.md), [0056](adr/0056-scoring-tokens-and-prompt-caching.md), [0065](adr/0065-merge-company-assessment-into-scoring.md), [0066](adr/0066-subscription-scoring-cache-and-usage.md), [0068](adr/0068-derive-score-cost-from-tokens.md), [0079](adr/0079-scored-means-a-persisted-numeric-result.md), [0101](adr/0101-per-company-apply-channel-assessment.md) |
| Candidate identity, preferences, and protected AI guidance | [0080](adr/0080-owner-neutral-prompts-and-candidate-context.md), [0081](adr/0081-per-user-chatgpt-and-candidate-profile-controls.md), [0083](adr/0083-validated-candidate-ai-policy-controls.md) |
| Subscription workers and per-user Claude/ChatGPT isolation | [0042](adr/0042-ai-on-claude-subscription-via-agent-sdk.md), [0069](adr/0069-chatgpt-subscription-and-three-ai-lanes.md), [0074](adr/0074-per-user-claude-subscription-connection.md), [0081](adr/0081-per-user-chatgpt-and-candidate-profile-controls.md) |
| Résumé tailoring, one-page PDF, caching, and response repair | [0024](adr/0024-custom-resume-generation.md), [0027](adr/0027-tailoring-on-worker.md), [0031](adr/0031-one-page-resume-token-and-caching.md), [0050](adr/0050-drop-tailored-resume-scoring.md), [0051](adr/0051-cover-letter-in-tailor-call.md), [0064](adr/0064-subscription-cache-fix-and-tailor-usage.md), [0084](adr/0084-shared-resume-paper-editor-and-review.md), [0085](adr/0085-user-defined-resume-sections.md), [0086](adr/0086-bounded-tailoring-json-control-character-repair.md) |
| Jobs/Tailor & Apply presentation and ATS comparison | [0063](adr/0063-opened-not-logged-indicator.md), [0078](adr/0078-jobs-filters-are-explicit-and-null-aware.md), [0090](adr/0090-tailor-apply-type-and-complete-ats-comparison.md), [0092](adr/0092-compact-jobs-fit-explanation.md) |
| AI Apply queue, autofill navigation, plugin/MCP, and pairing | [0093](adr/0093-supervised-external-application-handoff.md), [0094](adr/0094-extension-owned-autofill-ai-navigation.md), [0095](adr/0095-all-linked-jobs-with-known-fact-ai-fallback.md), [0096](adr/0096-applypilot-plugin-mcp-foundation.md), [0098](adr/0098-development-plugin-marketplace-and-live-smoke.md), [0099](adr/0099-single-use-codex-pairing.md), [0100](adr/0100-visible-already-applied-reconciliation.md) |
| Settings information architecture and résumé editing UI | [0082](adr/0082-goal-oriented-settings-navigation.md), [0084](adr/0084-shared-resume-paper-editor-and-review.md), [0085](adr/0085-user-defined-resume-sections.md) |

For a historical decision not represented here, search filenames first:

```bash
rg --files docs/adr | rg '<topic>'
```
