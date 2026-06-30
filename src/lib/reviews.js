// Build-time lookup into the scraped Google-review ledger
// (src/data/reviews_by_restaurant.json), keyed by license_key. The file
// intentionally carries NO reviewer personal data — only text, stars, date,
// local_guide and likes — so nothing here can leak PII.
//
// Presentation-only: returns the top few text reviews for a restaurant (newest
// first, capped) plus the scraped count/average for labelling. Returns null
// when the restaurant has no usable reviews, so the template omits the section.
import reviewsByRestaurant from '../data/reviews_by_restaurant.json';

const MAX_SHOWN = 4;
const EXCERPT_LIMIT = 280;

// Trim a review to a readable excerpt at a word boundary, with an ellipsis when
// truncated. Collapses internal whitespace so multi-line reviews stay tidy.
function excerpt(text, limit = EXCERPT_LIMIT) {
  const t = String(text).replace(/\s+/g, ' ').trim();
  if (t.length <= limit) return t;
  const cut = t.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > 60 ? cut.slice(0, lastSpace) : cut;
  return base.replace(/[.,;:!?\s]+$/, '') + '…';
}

const validStars = (s) => Number.isInteger(s) && s >= 1 && s <= 5;

export function reviewInfo(licenseKey) {
  const e = reviewsByRestaurant[String(licenseKey)];
  if (!e || !Array.isArray(e.reviews) || e.reviews.length === 0) return null;

  // Only reviews that actually carry text are worth showing.
  const withText = e.reviews.filter(
    (rv) => rv && typeof rv.text === 'string' && rv.text.trim()
  );
  if (withText.length === 0) return null;

  // Prefer reviews that carry a star rating (most do); fall back to all text
  // reviews if there aren't enough rated ones. File order is newest-first.
  const rated = withText.filter((rv) => validStars(rv.stars));
  const pool = rated.length >= 3 ? rated : withText;

  const items = pool.slice(0, MAX_SHOWN).map((rv) => ({
    excerpt: excerpt(rv.text),
    stars: validStars(rv.stars) ? rv.stars : null,
    date: rv.date || null,
  }));

  return {
    count: Number.isFinite(e.scraped_count) ? e.scraped_count : withText.length,
    avgStars: Number.isFinite(e.avg_stars_scraped) ? e.avg_stars_scraped : null,
    items,
  };
}
