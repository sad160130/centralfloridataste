// Complete hub-to-hub internal link graph.
//
// Every URL here is derived from the sets that actually BUILD (cities passing
// CITY_MIN, filterPages/specialPages passing their phase-1 thresholds), so a
// link emitted from this module can never point at a page that wasn't emitted.
// Manifest rows that fail those thresholds have no page and are deliberately
// absent — linking them would 404.
import { counties, cities, districts, cityHubSlugs } from './data.js';
import { filterPages, specialPages, sortFilters } from './manifest.js';
import { titleCase } from './format.js';

const slash = (u) => (u.endsWith('/') ? u : `${u}/`);

export const countyUrl = (s) => `/${s}-county/`;
export const cityUrl = (s) => `/${s}/`;
export const districtUrl = (s) => `/neighborhood/${s}/`;

/* ---------- geo indexes ---------- */
const countyBySlug = new Map(counties.map((c) => [c.slug, c]));
const cityBySlug = new Map(cities.map((c) => [c.slug, c]));

// city slug -> county slug, for every city that appears anywhere in the data
// (including cities with no hub of their own, whose combos still need a home).
const countyOfCity = new Map();
for (const c of cities) countyOfCity.set(c.slug, c.items[0].county_slug);
for (const p of filterPages) {
  if (p.geoType === 'city' && p.items[0]) countyOfCity.set(p.geoSlug, p.items[0].county_slug);
}
for (const p of specialPages) {
  if (p.geoType === 'city' && p.items[0]) countyOfCity.set(p.geoSlug, p.items[0].county_slug);
}

const cityNameOf = (slug) => {
  const c = cityBySlug.get(slug);
  if (c) return titleCase(c.name);
  const p = filterPages.find((x) => x.geoType === 'city' && x.geoSlug === slug) ||
            specialPages.find((x) => x.geoType === 'city' && x.geoSlug === slug);
  return p ? p.geoName : titleCase(slug.replace(/-/g, ' '));
};

const cityHubsByCounty = new Map();
for (const c of cities) {
  const k = c.items[0].county_slug;
  if (!cityHubsByCounty.has(k)) cityHubsByCounty.set(k, []);
  cityHubsByCounty.get(k).push(c);
}
const districtsByCounty = new Map();
for (const d of districts) {
  const k = d.items[0].county_slug;
  if (!districtsByCounty.has(k)) districtsByCounty.set(k, []);
  districtsByCounty.get(k).push(d);
}

/* ---------- combo + curated indexes ---------- */
const idx = (pages, type) => {
  const m = new Map();
  for (const p of pages) {
    if (p.geoType !== type) continue;
    if (!m.has(p.geoSlug)) m.set(p.geoSlug, []);
    m.get(p.geoSlug).push(p);
  }
  return m;
};
const combosByCity = idx(filterPages, 'city');
const combosByCounty = idx(filterPages, 'county');
const combosByDistrict = idx(filterPages, 'district');
const curatedByCity = idx(specialPages, 'city');
const curatedByCounty = idx(specialPages, 'county');

const link = (p) => ({
  url: slash(p.url),
  label: p.kind === 'cuisine' ? `${p.label} restaurants` : p.label,
  count: p.items.length,
});
const curatedLink = (p) => ({ url: slash(p.url), label: p.label, count: p.items.length });
const get = (m, k) => m.get(k) || [];

export const combosForCity = (s) => sortFilters(get(combosByCity, s)).map(link);
export const combosForCounty = (s) => sortFilters(get(combosByCounty, s)).map(link);
export const combosForDistrict = (s) => sortFilters(get(combosByDistrict, s)).map(link);
export const curatedForCity = (s) => get(curatedByCity, s).map(curatedLink);
export const curatedForCounty = (s) => get(curatedByCounty, s).map(curatedLink);

/* ---------- 3. COUNTY hub: complete coverage of everything beneath it ---------- */
export function countyHubLinks(countySlug) {
  const cityHubs = [...get(cityHubsByCounty, countySlug)].sort((a, b) => b.items.length - a.items.length);

  // Every city in this county that owns a combo or curated hub — whether or not
  // the city itself has a hub — so nothing beneath the county is unreachable.
  const citySlugs = new Set();
  for (const [cs, cty] of countyOfCity) if (cty === countySlug) citySlugs.add(cs);

  const byCity = [];
  for (const cs of [...citySlugs].sort((a, b) => cityNameOf(a).localeCompare(cityNameOf(b)))) {
    const pages = [...combosForCity(cs), ...curatedForCity(cs)];
    if (!pages.length) continue;
    byCity.push({ city: cityNameOf(cs), citySlug: cs, hasHub: cityHubSlugs.has(cs), pages });
  }

  const districtGroups = get(districtsByCounty, countySlug)
    .map((d) => ({ name: d.name, slug: d.slug, url: districtUrl(d.slug), pages: combosForDistrict(d.slug) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    cityHubs,
    countyLevel: [...combosForCounty(countySlug), ...curatedForCounty(countySlug)],
    byCity,
    districtGroups,
  };
}

/* ---------- 4. CITY hub ---------- */
export function cityHubLinks(citySlug) {
  const countySlug = countyOfCity.get(citySlug);
  const county = countyBySlug.get(countySlug);
  const siblings = get(cityHubsByCounty, countySlug)
    .filter((c) => c.slug !== citySlug)
    .sort((a, b) => b.items.length - a.items.length)
    .map((c) => ({ url: cityUrl(c.slug), label: titleCase(c.name), count: c.items.length }));
  return {
    own: [...combosForCity(citySlug), ...curatedForCity(citySlug)],
    county: county ? { url: countyUrl(county.slug), label: `${county.name} County`, count: county.items.length } : null,
    siblings,
  };
}

/* ---------- DISTRICT hub: parent county + sibling districts ---------- */
export function districtHubLinks(districtSlug) {
  const d = districts.find((x) => x.slug === districtSlug);
  const countySlug = d ? d.items[0].county_slug : null;
  const co = countyBySlug.get(countySlug);
  return {
    county: co ? { url: countyUrl(co.slug), label: `${co.name} County`, count: co.items.length } : null,
    siblings: get(districtsByCounty, countySlug)
      .filter((x) => x.slug !== districtSlug)
      .map((x) => ({ url: districtUrl(x.slug), label: x.name, count: x.items.length }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

/* ---------- 5. COMBO / CURATED hub: parents + siblings ---------- */
export function comboHubLinks({ geoType, geoSlug, currentUrl }) {
  const cur = slash(currentUrl);
  let siblings = [];
  let city = null;
  let county = null;
  let district = null;

  let curated = [];
  if (geoType === 'city') {
    curated = curatedForCity(geoSlug);
    siblings = [...combosForCity(geoSlug), ...curated];
    if (cityHubSlugs.has(geoSlug)) {
      const c = cityBySlug.get(geoSlug);
      city = { url: cityUrl(geoSlug), label: `All ${titleCase(c.name)} restaurants`, count: c.items.length };
    }
    const cs = countyOfCity.get(geoSlug);
    const co = countyBySlug.get(cs);
    if (co) county = { url: countyUrl(co.slug), label: `All ${co.name} County restaurants`, count: co.items.length };
  } else if (geoType === 'county') {
    curated = curatedForCounty(geoSlug);
    siblings = [...combosForCounty(geoSlug), ...curated];
    const co = countyBySlug.get(geoSlug);
    if (co) county = { url: countyUrl(co.slug), label: `All ${co.name} County restaurants`, count: co.items.length };
  } else {
    siblings = combosForDistrict(geoSlug);
    const d = districts.find((x) => x.slug === geoSlug);
    if (d) {
      district = { url: districtUrl(d.slug), label: `All ${d.name} restaurants`, count: d.items.length };
      const co = countyBySlug.get(d.items[0].county_slug);
      if (co) county = { url: countyUrl(co.slug), label: `All ${co.name} County restaurants`, count: co.items.length };
    }
  }
  return {
    siblings: siblings.filter((s) => s.url !== cur),
    curated: curated.filter((s) => s.url !== cur),
    city, county, district,
  };
}

/* ---------- 6. LISTING page: the guides this restaurant qualifies for ----------
   Its cuisine guide and each dietary guide whose flag it carries, scoped to its
   own city. Curated guides (top-rated-safe / worst-scores / hidden gems) are
   included only when this restaurant is actually ON that list — membership is
   checked against the page's own item set, never inferred. Without this, a
   curated hub in a city that has neither a city hub nor any combo hub (e.g.
   Maitland) would have no inlink source but the county hub and /guides/. */
export function restaurantCombos(r) {
  const out = [];
  for (const p of get(combosByCity, r.city_slug)) {
    const qualifies =
      p.kind === 'cuisine'
        ? p.cuisine === r.cuisine
        : Array.isArray(r.dietary) && r.dietary.includes(p.flag);
    if (qualifies) out.push(p);
  }
  const combos = sortFilters(out).map(link);

  const curated = get(curatedByCity, r.city_slug)
    .filter((p) => p.items.some((x) => x.license_key === r.license_key))
    .map(curatedLink);

  return [...combos, ...curated];
}

/* ---------- 1. /guides/ : every built hub, grouped county > city > type ---------- */
export function guidesTree() {
  return [...counties]
    .sort((a, b) => b.items.length - a.items.length)
    .map((co) => {
      const l = countyHubLinks(co.slug);
      return {
        slug: co.slug,
        name: co.name,
        url: countyUrl(co.slug),
        count: co.items.length,
        countyLevel: l.countyLevel,
        cities: [...l.cityHubs]
          .sort((a, b) => titleCase(a.name).localeCompare(titleCase(b.name)))
          .map((c) => ({
            name: titleCase(c.name),
            slug: c.slug,
            url: cityUrl(c.slug),
            count: c.items.length,
            pages: [...combosForCity(c.slug), ...curatedForCity(c.slug)],
          })),
        // Cities with combo/curated hubs but no hub of their own.
        otherCities: l.byCity.filter((g) => !g.hasHub),
        districts: l.districtGroups,
      };
    });
}
