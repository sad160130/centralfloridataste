---
name: visual-semantics
description: >
  Enforces the on-page visual-semantics rules for centralfloridataste.org — the
  structure Google uses to classify a page and pick its centerpiece annotation.
  Use when building or reviewing page templates, when adding a new page type, and
  on every weekly publish batch before it deploys. Triggers on "run the
  visual-semantics checks", "check the centerpiece", "audit page structure".
---

# Visual semantics — page structure rules

When the underlying facts are public and identical across competitors (DBPR
inspection data), differentiation comes from **structure, function and
annotation** — not text. These four rules were validated against the live
templates; every page type on the site passes them today.

Run the checks against **built** pages:

```bash
node .claude/skills/visual-semantics/check.mjs                 # whole site
node .claude/skills/visual-semantics/check.mjs --pages new.txt # only new URLs (one per line)
node .claude/skills/visual-semantics/check.mjs --json          # machine-readable
```

Exit code `0` = all rules pass; `1` = at least one failure. **A failing page does
not ship.** Fix the shared template, not the individual page — a template fix
retrofits every already-published page on the next build.

---

## R1 — The verdict leads the centerpiece

**Rule.** The sentence that answers the page's query must be the first thing in
`<main>`: the "is this kitchen clean?" verdict on a detail page, the equivalent
functional lead (stat line, count, ranked-list intro) on a hub, filter or
special page. Nothing incidental may precede it — not a photo credit, not the
DBPR disclaimer, not a "last updated" line. Those are trust signals and
decoration; they belong below the fold.

**Check.** Within the first **200 characters** of `<main>` (nav stripped) the
page must open with the grade placard (`A 97`, or `NR` for an unrated kitchen)
or carry a metric plus a domain term. Within the first **400 characters** —
the block an extractor is likely to lift — `Photo:`, `This grade is calculated`
and `Data last updated` must not appear. Narrative pages (`/about/`,
`/methodology/`, `/data-sources/`) are exempt from the metric requirement but
not from the boilerplate ban.

## R2 — The primary verdict exists in structured data

**Rule.** A page's core signal must be machine-readable, not merely visible. On
a detail page that is the calculated health grade, expressed as a critic-style
`Review` authored by the publisher `Organization`, on an explicit 0–100 scale,
carrying the A–F letter, framed as calculated-not-official — and kept distinct
from the diner `aggregateRating`. An unrated (NR) restaurant asserts **nothing**:
no review, no grade properties. A page that declares itself a `CollectionPage`
must enumerate what it collects.

**Check.** For detail pages: `Restaurant.review.reviewRating` is a `Rating` with
`bestRating: 100` / `worstRating: 0`, `alternateName` matching `Grade [A-F]`,
`author.@id` pointing at the publisher Organization, and not-official wording in
`reviewBody` or `ratingExplanation`; a graded page must have it and an NR page
must not. For any page declaring `CollectionPage`: an `ItemList` must be present.
Every other page must declare at least one page-level type beyond `Organization`.

## R3 — Every functional block is named

**Rule.** A machine should be able to tell where each component begins and what
it is. No primary component — ranked list, filtered set, hub section — ships
without a heading, and every `<section>` is tied to that heading with
`aria-labelledby`.

**Check.** Zero `<section>` elements in `<main>` without `aria-label` or
`aria-labelledby`, and any `ul.cards` must be preceded by an `<h2>`.

## R4 — The first 400 characters are page-unique

**Rule.** The centerpiece window is the page's scarcest asset. Sitewide
boilerplate there makes the most-extracted block identical across pages — the
opposite of differentiation on a commodity-data site.

**Check.** Tokenise the first 400 characters of each page; a token appearing on
more than **50%** of the checked pages counts as boilerplate. At least **40%** of
a page's centerpiece tokens must fall outside that set. Attribution, disclaimer
and "last updated" text in the window is an automatic failure (shared with R1).

---

## Applying this to a new page type

1. Lead `<main>` with the component that serves the query; push photo,
   attribution and disclaimers below it.
2. Give the primary component a heading and bind the section to it.
3. Put the page's core signal in JSON-LD — and if it declares `CollectionPage`,
   enumerate the items.
4. Run the checks. If a rule fails, fix the shared template.

Thresholds live at the top of `check.mjs` (`VERDICT_WINDOW`, `CENTERPIECE`,
`UNIQUE_MIN`, `BOILERPLATE_DF`). They are calibrated so the current production
build passes with zero failures — re-verify against a full run before loosening
any of them.
