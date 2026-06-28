---
name: central-florida-weekly-publish
description: >
  Orchestrates the weekly Sunday batch publish for the Central Florida Restaurant
  Grades directory. Triggers on "do the weekly publish", "run the Sunday publish",
  "publish this week's batch", or "ship the next pages". Publishes a fixed batch of
  new pages from the phased manifest and runs each through the SEO skill stack so
  every published page is search- and answer-engine-optimized. Also handles the
  monthly DBPR data refresh on the trigger "re-score the DBPR batch".
---

# Central Florida — Weekly Publish Orchestration

Encodes the full Sunday batch-publish run so it fires from one natural-language command.
This is the executable trigger layer; the human-readable reference of record is the
ERFNYC knowledge base (`/docs/erfnyc-playbook.md`).

## Project constants (market-specific)
- **Region:** DBPR District 4 = 8 counties (Orange, Brevard, Volusia, Seminole, Osceola, Lake, St. Lucie, Indian River).
- **Data files:** `Data/page_manifest.csv` (6,790 pages, `type/url/filter/listing_count/phase`), `src/data/restaurants.json` (enriched listings), `Data/region4_master.csv` (canonical record).
- **Health score (locked v1):** start 100; −8 high-priority, −3 intermediate, −1 basic; disposition + recent-emergency penalties; bands A≥90 B≥80 C≥70 D≥60 F<60; NR if no recent inspection. Florida issues no official grades — every page must say the grade is *calculated*.
- **12 dietary flags:** vegan, vegetarian, gluten_free, dairy_free, keto, paleo, halal, kosher, organic, healthy, nut_aware, pescatarian.
- **BATCH_SIZE:** 250 pages/week (start conservative; only raise once GSC shows clean indexation — see step 8).
- **Publish gate:** templates emit a page only when `published === true`. All Phase-1 pages are already `published`; weekly batches flip the next rows.
- **Ledger:** `Data/publish_log.json` — append `{date, batch_size, license_keys[], combo_urls[], cumulative_total}` each run.

## TRIGGER: "do the weekly publish"

Run these steps in order. **Pause for diff review before step 6 (apply/commit) — this is mandatory.**

**1. Select the batch.**
From `Data/page_manifest.csv`, take the next `BATCH_SIZE` *unpublished* pages, ordered by `phase` (2 then 3) and then by priority (review volume, match confidence, hidden-gem, district, notable grade). Listings drive the batch; combo and special pages (dietary×geo, cuisine×geo, hidden-gems, grade-A, worst-scores) are pulled in automatically when enough of their listings are now published to clear the page's threshold.

**2. Promote them.**
Set `published: true` (with this Sunday's date) on those entries in `src/data/restaurants.json`, and record them in `Data/publish_log.json`. Do not touch already-published pages.

**3. Build.** Run `npm run build` (astro-seo-directory; static output, zero content JS).

**4. SEO optimization stack — trigger each dedicated skill on the NEW pages only:**
- **seo-technical-audit** → every new page has a unique ≤60-char title and ≤155-char meta (append street/neighborhood to break same-name collisions), self-canonical, OG/Twitter, valid `Restaurant` + `BreadcrumbList` JSON-LD with `publisher` + `dateModified`; confirm zero content JS and zero images; regenerate `sitemap` to include the new URLs.
- **seo-internal-linking** → wire each new listing into its county/city/district hubs and its matching dietary/cuisine/special pages; give every new page links up to its hubs and across to 3–4 siblings; verify **no orphans** and that new hubs/filters that just crossed threshold are linked from their parents.
- **seo-aeo-geo-visibility** → confirm each new page is answer-engine-ready: clean H1, a factual lead summary, complete structured data, and the "grade is calculated from DBPR public records / Florida issues no official grades" attribution linking to `/methodology/`.
- **seo-keyword-intent-research** (combo/special pages only) → sanity-check the title/H1 against real intent; keep proprietary framing where it's defensible (e.g. "hidden gems") rather than drifting to generic head terms by accident.

**5. Technical floor check.** Static-text litmus (View Source shows content), 404 intact, canonical/OG/schema present on a sampled new page of each type. Report a pass/fail table by page type.

**6. ⏸ DIFF REVIEW — pause and show me the diffs before applying.** (Mandatory per operating principles.) Summarize: which pages were added, total now live, any audit fixes made.

**7. Publish.** On approval: commit with `chore(publish): weekly batch YYYY-MM-DD — N pages (cumulative M)`, rebuild `dist/`, deploy to host, and submit the updated sitemap / ping IndexNow so the new URLs are discovered. Append to `Data/publish_log.json` and update `MEMORY.md` with the cumulative total.

**8. GSC gate (before NEXT week).** Check the prior batches in Google Search Console — indexation rate, impressions, any coverage errors. **Do not raise BATCH_SIZE until prior batches are indexing cleanly.** If indexation stalls, hold the next batch and investigate before publishing more.

## TRIGGER: "re-score the DBPR batch" (monthly / when DBPR refreshes)
Re-pull the District 4 inspection + license extracts, re-run the scoring pipeline (`score_establishments.py`), re-merge enrichment, and refresh `restaurants.json` + `region4_master.csv` so health scores reflect new inspections. Already-published pages update in place on the next build; do not change their published status. Keep the join-key rule (strip the rank-code prefix + leading zeros) and `dtype=str` discipline.

## Notes
- Run manually each Sunday by typing the trigger, or schedule it — but always honor the step-6 diff-review pause.
- Never publish all remaining pages at once; the weekly cadence is itself a ranking signal.
