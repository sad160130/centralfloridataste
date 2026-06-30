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
- **Data files:** `Data/page_manifest.csv` (6,790 pages, `type/url/listing_count/phase`), `src/data/restaurants.json` (enriched listings), `Data/region4_master.csv` (canonical record), `Data/photo_cache.json` (photo ledger — see below).
- **Health score (locked v1):** start 100; −8 high-priority, −3 intermediate, −1 basic; disposition + recent-emergency penalties; bands A≥90 B≥80 C≥70 D≥60 F<60; NR if no recent inspection. Florida issues no official grades — every page must say the grade is *calculated*.
- **12 dietary flags:** vegan, vegetarian, gluten_free, dairy_free, keto, paleo, halal, kosher, organic, healthy, nut_aware, pescatarian.
- **BATCH_SIZE:** 250 pages/week (start conservative; only raise once GSC shows clean indexation — see step 9).
- **Publish gate:** templates emit a page only when `published === true`. All Phase-1 pages are already `published`; weekly batches flip the next rows.
- **Photos:** `scripts/fetch-restaurant-photos.mjs` fetches one storefront photo per restaurant from the Google Places API and uploads it to **Vercel Blob**; the ledger `Data/photo_cache.json` (keyed by `license_key`) holds the `blob_url` + Google attribution + fetch timestamp. Templates (`src/lib/photos.js`) read the ledger and lazy-load the Blob image into the card head + detail hero, with the grade-tinted **monogram** tile as the fallback when `status:"none"`. The detail page renders Google's required photo attribution. Image bytes live in Blob and a git-ignored local cache — they never enter the repo.
- **Ledger:** `Data/publish_log.json` — append `{date, batch_size, license_keys[], combo_urls[], cumulative_total}` each run.

## TRIGGER: "do the weekly publish"

Run these steps in order. **Pause for diff review before step 8 (publish/commit) — this is mandatory.**

**1. Select the batch.**
From `Data/page_manifest.csv`, take the next `BATCH_SIZE` *unpublished* pages, ordered by `phase` (2 then 3) and then by priority (review volume, match confidence, hidden-gem, district, notable grade). Listings drive the batch; combo and special pages (dietary×geo, cuisine×geo, hidden-gems, grade-A, worst-scores) are pulled in automatically when enough of their listings are now published to clear the page's threshold.

**2. Promote them.**
Set `published: true` (with this Sunday's date) on those entries in `src/data/restaurants.json`, and record them in `Data/publish_log.json`. Do not touch already-published pages.

**3. Fetch photos for the newly-published batch.**
Run `node scripts/fetch-restaurant-photos.mjs` (reads `GOOGLE_MAPS_API_KEY` + `BLOB_READ_WRITE_TOKEN` from `.env`). It scans every `published === true` restaurant, but the **25-day cache + idempotent Blob skip** mean only this week's `license_key`s actually fetch — already-cached rows (a `blob_url` fetched < 25 days ago, or a known `status:"none"`) are skipped at ≈$0. For each new restaurant: Place Details (`fields=photos`) → **refine** (prefer a business/editorial-attributed photo among the first ~4 over a random user photo, falling back through the list) → Place Photo (`maxwidth=800`) → upload to Vercel Blob (`access:'public'`, stable path) → record `{status:"ok", blob_url, attribution, photo_reference, chosen_index, fetched_at}` in `Data/photo_cache.json`. A restaurant with no usable photo is recorded `status:"none"` → templates use the monogram tile. **This must run before the build** so the new pages pick up their Blob URLs.
- **Expected cost:** ≈ BATCH_SIZE × (Place Details $0.017 + Place Photo $0.007) = **~250 × $0.024 ≈ $6 per batch** — a few dollars, well inside the $200/month credit. (Re-runs of unchanged rows cost ~$0; the only other recurring cost is the 25-day refresh, when rows older than 25 days re-fetch on a subsequent run.)

**4. Build.** Run `npm run build` (astro-seo-directory; static output, zero content JS; cards lazy-load the Blob photo, detail hero is eager).

**5. SEO optimization stack — trigger each dedicated skill on the NEW pages only:**
- **seo-technical-audit** → every new page has a unique ≤60-char title and ≤155-char meta (append street/neighborhood to break same-name collisions), self-canonical, OG/Twitter, valid `Restaurant` + `BreadcrumbList` JSON-LD with `publisher` + `dateModified`; confirm zero content JS; regenerate `sitemap` to include the new URLs.
- **seo-internal-linking** → wire each new listing into its county/city/district hubs and its matching dietary/cuisine/special pages; give every new page links up to its hubs and across to 3–4 siblings; verify **no orphans** and that new hubs/filters that just crossed threshold are linked from their parents.
- **seo-aeo-geo-visibility** → confirm each new page is answer-engine-ready: clean H1, a factual lead summary, complete structured data, and the "grade is calculated from DBPR public records / Florida issues no official grades" attribution linking to `/methodology/`.
- **seo-keyword-intent-research** (combo/special pages only) → sanity-check the title/H1 against real intent; keep proprietary framing where it's defensible (e.g. "hidden gems") rather than drifting to generic head terms by accident.

**6. Technical floor check.** Static-text litmus (View Source shows content), 404 intact, canonical/OG/schema present on a sampled new page of each type; spot-check a new card + detail page render the Blob photo (or monogram) with attribution. Report a pass/fail table by page type.

**7. ⏸ DIFF REVIEW — pause and show me the diffs before applying.** (Mandatory per operating principles.) Summarize: pages added, total now live, new photos fetched + per-batch photo cost, any audit fixes made.

**8. Publish.** On approval: commit with `chore(publish): weekly batch YYYY-MM-DD — N pages (cumulative M)` — **include the updated `Data/photo_cache.json`** so the build resolves the new Blob photos (image bytes stay out of the repo). Rebuild `dist/`, deploy to host, and submit the updated sitemap / ping IndexNow so the new URLs are discovered. Append to `Data/publish_log.json` and update `MEMORY.md` with the cumulative total.

**9. GSC gate (before NEXT week).** Check the prior batches in Google Search Console — indexation rate, impressions, any coverage errors. **Do not raise BATCH_SIZE until prior batches are indexing cleanly.** If indexation stalls, hold the next batch and investigate before publishing more.

## TRIGGER: "re-score the DBPR batch" (monthly / when DBPR refreshes)
Re-pull the District 4 inspection + license extracts, re-run the scoring pipeline (`score_establishments.py`), re-merge enrichment, and refresh `restaurants.json` + `region4_master.csv` so health scores reflect new inspections. Already-published pages update in place on the next build; do not change their published status. Photos are unaffected (the ledger persists); they only re-fetch on the 25-day cycle. Keep the join-key rule (strip the rank-code prefix + leading zeros) and `dtype=str` discipline.

## Notes
- Run manually each Sunday by typing the trigger, or schedule it — but always honor the step-7 diff-review pause.
- Never publish all remaining pages at once; the weekly cadence is itself a ranking signal.
