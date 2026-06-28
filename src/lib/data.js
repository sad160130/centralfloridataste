// Single source of truth for phase-filtered groupings used by hub pages,
// the homepage, and internal-link guards on detail pages.
import restaurants from '../data/restaurants.json';

export const CITY_MIN = 10; // a city gets its own hub only with this many phase-1 entries

// Publish gate: a restaurant is live only when published === true (weekly batches
// flip this on the next rows). Phase-1 rows were seeded published === true.
export const phase1 = restaurants.filter((r) => r.published === true);

export function groupBy(items, slugKey, nameKey) {
  const m = new Map();
  for (const r of items) {
    const slug = r[slugKey];
    if (slug == null || slug === '') continue;
    if (!m.has(slug)) m.set(slug, { slug, name: r[nameKey], items: [] });
    m.get(slug).items.push(r);
  }
  return m;
}

export const counties = [...groupBy(phase1, 'county_slug', 'county').values()];
export const cities = [...groupBy(phase1, 'city_slug', 'city').values()].filter(
  (c) => c.items.length >= CITY_MIN
);
export const districts = [...groupBy(phase1, 'district_slug', 'district').values()];

// Which hubs actually exist — detail pages use these to avoid linking to 404s.
export const cityHubSlugs = new Set(cities.map((c) => c.slug));
export const districtHubSlugs = new Set(districts.map((d) => d.slug));
