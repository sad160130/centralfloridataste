// Build-time lookup into the scraped Google-review ledger
// (src/data/reviews_by_restaurant.json), keyed by license_key. The file
// intentionally carries NO reviewer personal data — only text, stars, date,
// local_guide and likes — so nothing here can leak PII.
//
// Presentation-only: returns EVERY text review we hold for a restaurant
// (newest first, as stored) plus the scraped count/average for labelling.
// Returns null when the restaurant has no usable reviews, so the template
// omits the section. Review text is rendered IN FULL — no excerpting.
//
// The template renders `visible` inline and `hidden` inside a <details>, so all
// review text ships in the static HTML either way — the split is a fold, not a
// filter, and View Source shows every review.
import reviewsByRestaurant from '../data/reviews_by_restaurant.json';

// How many render above the fold before the "Show all N reviews" expander.
const VISIBLE = 5;

const validStars = (s) => Number.isInteger(s) && s >= 1 && s <= 5;

export function reviewInfo(licenseKey) {
  const e = reviewsByRestaurant[String(licenseKey)];
  if (!e || !Array.isArray(e.reviews) || e.reviews.length === 0) return null;

  // Only reviews that actually carry text are worth showing.
  const withText = e.reviews.filter(
    (rv) => rv && typeof rv.text === 'string' && rv.text.trim()
  );
  if (withText.length === 0) return null;

  // Stored newest-first; keep that order rather than re-ranking.
  const items = withText.map((rv) => ({
    text: String(rv.text).trim(), // full review text — never truncated here
    stars: validStars(rv.stars) ? rv.stars : null,
    date: rv.date || null,
  }));

  return {
    // Reviews we actually hold and render (not the scraped_count, which counts
    // rows including any without text) — this is what the toggle label states.
    total: items.length,
    count: Number.isFinite(e.scraped_count) ? e.scraped_count : items.length,
    avgStars: Number.isFinite(e.avg_stars_scraped) ? e.avg_stars_scraped : null,
    items,
    visible: items.slice(0, VISIBLE),
    hidden: items.slice(VISIBLE),
  };
}
