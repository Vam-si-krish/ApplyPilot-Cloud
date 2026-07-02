# 0058 — LinkedIn query refinement + spend guards (+ career-sites portal, wired but off)

## Context

The user asked for two things: research a better fetch source within ~$30/month, and refine the
LinkedIn (cheap_scraper) query "so it matches proper jobs and I don't waste time fetching jobs
that I don't need and pay extra".

Evidence gathered before changing anything:

- **Account state**: the vault rotates SIX free Apify accounts (6 × $5 = $30/month pool). The
  *active* key was maxed at $5.00/$5.00, so runs were silently failing; ~$14.8 of pool credit sat
  unused on sibling keys. $4.64 of the active account's $5 was cheap_scraper per-result billing.
- **Same-day duplicate runs**: Jun 20 had 3 runs ($1.04), Jun 21 two runs 2 minutes apart —
  each re-bills the same 24h look-back window.
- **Locations are NOT the waste**: the user applies nationwide (127 applies outside the saved
  metros — SF/Seattle/Atlanta/…), so narrowing locations would cut wanted jobs.
- **Titles are NOT the waste either**: only ~18% of canonicals are truly off-title, and even
  those yielded 19 applies (e.g. "Product Engineer" avg 7.2). Aggressive title filters would
  cut good jobs; the LLM scorer already handles the junk tail.
- **"Remote, US" was a broken search**: LinkedIn has no "Remote" geo — remote is the `f_WT=2`
  facet on a real location. The literal string was ungeocodable.
- **Career-sites actor pricing**: `fantastic-jobs~career-site-job-listing-api` bills
  **$0.012/job ($12/1k) on FREE/BRONZE tiers** (the advertised "$4/1k" is the GOLD tier,
  i.e. the $999/mo Apify plan). User verdict: too high to enable.

## Decision

1. **Boolean query per location** (`booleanKeywordQuery`): the 5 role keywords collapse into one
   quoted `"kw1" OR "kw2" …` guest-search query, one startUrl per *location* instead of per
   role×location (30 → 6 searches). Same unique set, exact-phrase matching, far fewer crawled
   pages. The maxItems cap formula is unchanged (still keywords × locations × results_per_query).
2. **Real remote search** (`parseLinkedInLocation`): remote-ish locations become
   `location=United States (or the remainder) + f_WT=2`.
3. **Pre-billing facets in the URL**: `f_E` experience levels from the new
   `settings.linkedin_experience_levels` (UI checkboxes; live value `{2,3,4}` = Entry/Associate/
   Mid-Senior) and hard-coded `f_JT=F,C` (full-time + contract — the scorer flags contract
   rather than demoting it, ADR 0022). URL facets filter inside LinkedIn's search, BEFORE the
   pay-per-result actor bills; the actor's own "dynamic filters" are post-fetch and still billed.
4. **Run cooldown guard** (`/api/run`): a run started < 12h ago (any status but `failed`) makes
   the route return `{skipped, cooldown, reason}` instead of re-buying the window. Manual
   override: `POST {"force":true}` (the Dashboard/Jobs buttons confirm-and-force) or `?force=1`.
5. **Credit-aware key selection** (`ensureApifyKeyWithCredit`): after the blind ADR-0007
   rotation, /api/run verifies the active apify key has ≥ $0.50 headroom via the Apify limits
   API, else activates the next vault key that does; when ALL are dry it fails loudly (402)
   instead of starting a doomed run. Unknown headroom (API down) never blocks a run.
6. **career_sites portal exists but is OFF**: full input builder (`titleSearchTerms`,
   `careerSiteLocations`, 24h timeRange, `career_sites_max_jobs` cap = the spend dial,
   removeAgency, FULL_TIME+CONTRACTOR) + dataset mapping (organization, locations_derived,
   description_text, ai_salary_*, org_linkedin_size, Remote prefix). It is opt-in via the
   Settings portal checkbox, which shows the honest $12/1k price. Not added to `job_portals`.

Migration 0036→**0037** adds `linkedin_experience_levels text[]` and `career_sites_max_jobs int
default 150` (applied live).

## Consequences

- The daily LinkedIn spend now buys only full-time/contract roles at the chosen seniority, and
  the previously-dead "Remote, US" slice of the funnel works.
- Accidental double-runs and maxed-key silent failures — the two observed money leaks — are
  guarded at the route.
- Boolean search is one query LinkedIn ranks holistically; per-role result balance is no longer
  guaranteed (acceptable: the cap was global anyway).
- If cheap_scraper mishandles quoted/OR queries the fallback is trivial (revert to per-role
  startUrls); watch the first runs.
- career_sites can be enabled any time from Settings; at $12/1k its 150-cap costs ≈ $1.80/run.
