// Parses Data/page_manifest.csv (the authority for which filter pages exist and
// their exact URLs) and resolves each filter page to its matching PHASE-1
// restaurants. Manifest listing_count is computed over the full dataset, so we
// re-match against phase-1 data and drop pages that would be thin (< PHASE1_MIN).
import fs from 'node:fs';
import { phase1, cityHubSlugs } from './data.js';
import { titleCase } from './format.js';

const PHASE1_MIN = 3; // a filter page needs at least this many phase-1 listings to ship now
const TYPES = new Set(['dietary_city', 'dietary_county', 'dietary_district', 'cuisine_city']);

// flag (as stored in restaurants[].dietary) -> human label
const DIETARY_LABELS = {
  vegan: 'Vegan',
  vegetarian: 'Vegetarian',
  gluten_free: 'Gluten-Free',
  dairy_free: 'Dairy-Free',
  keto: 'Keto',
  paleo: 'Paleo',
  halal: 'Halal',
  kosher: 'Kosher',
  organic: 'Organic',
  healthy: 'Healthy Options',
  nut_aware: 'Nut-Aware',
  pescatarian: 'Pescatarian',
};

const parseFilter = (f) => Object.fromEntries(f.split('&').map((kv) => kv.split('=')));

// Minimal CSV line parser — some filters contain a quoted comma (e.g. "grade_in=D,F").
function parseLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const raw = fs.readFileSync(new URL('../../Data/page_manifest.csv', import.meta.url), 'utf8');
const rows = raw
  .split(/\r?\n/)
  .filter(Boolean)
  .slice(1)
  .map((l) => {
    const [type, url, filter, listing_count, phase] = parseLine(l);
    return { type, url, filter, listing_count: Number(listing_count), phase: Number(phase) };
  });

function matchItems(pf) {
  return phase1.filter((r) => {
    if (pf.city_slug && r.city_slug !== pf.city_slug) return false;
    if (pf.county_slug && r.county_slug !== pf.county_slug) return false;
    if (pf.district_slug && r.district_slug !== pf.district_slug) return false;
    if (pf.cuisine && r.cuisine !== pf.cuisine) return false;
    for (const [k, v] of Object.entries(pf)) {
      if (k.endsWith('_slug') || k === 'cuisine') continue;
      if (v === 'true' && !(Array.isArray(r.dietary) && r.dietary.includes(k))) return false;
    }
    return true;
  });
}

function enrich(r) {
  const pf = parseFilter(r.filter);
  const segs = r.url.split('/').filter(Boolean);
  const filterSlug = segs[segs.length - 1];

  let geoType, geoSlug;
  if (pf.district_slug) { geoType = 'district'; geoSlug = pf.district_slug; }
  else if (pf.county_slug) { geoType = 'county'; geoSlug = pf.county_slug; }
  else { geoType = 'city'; geoSlug = pf.city_slug; }

  const kind = pf.cuisine ? 'cuisine' : 'dietary';
  const flag =
    kind === 'dietary' ? Object.keys(pf).find((k) => !k.endsWith('_slug') && k !== 'cuisine') : null;

  const items = matchItems(pf);
  const sample = items[0];
  const geoName = !sample
    ? geoSlug
    : geoType === 'district'
      ? sample.district
      : geoType === 'county'
        ? sample.county
        : titleCase(sample.city);

  const label = kind === 'cuisine' ? titleCase(pf.cuisine) : DIETARY_LABELS[flag] || titleCase(flag);

  return {
    type: r.type, url: r.url, geoType, geoSlug, geoName, kind, filterSlug,
    flag, cuisine: pf.cuisine || null, label, items,
  };
}

export const filterPages = rows
  .filter((r) => TYPES.has(r.type) && r.phase === 1)
  .map(enrich)
  .filter((p) => p.items.length >= PHASE1_MIN);

// Index by geography for hub cross-linking and sibling cross-linking.
function indexByGeo(type) {
  const m = new Map();
  for (const p of filterPages) {
    if (p.geoType !== type) continue;
    if (!m.has(p.geoSlug)) m.set(p.geoSlug, []);
    m.get(p.geoSlug).push(p);
  }
  return m;
}
export const cityFilters = indexByGeo('city');
export const countyFilters = indexByGeo('county');
export const districtFilters = indexByGeo('district');

// Flag filter pages whose SEO title would collide (a city and a same-named
// district, or "vegan" dietary vs "vegan" cuisine). The secondary page
// (district, or cuisine) gets disambiguated in its title — see FilterPageView.
{
  const baseTitle = (p) =>
    `${p.label} Restaurants in ${p.geoType === 'county' ? `${p.geoName} County` : p.geoName}, FL`.slice(0, 60);
  const counts = new Map();
  for (const p of filterPages) counts.set(baseTitle(p), (counts.get(baseTitle(p)) || 0) + 1);
  for (const p of filterPages) {
    if (counts.get(baseTitle(p)) > 1 && (p.geoType === 'district' || p.kind === 'cuisine')) {
      p.disambiguate = true;
    }
  }
}

// Dietary first, then cuisine; alphabetical within each.
export const sortFilters = (arr) =>
  [...arr].sort((a, b) =>
    a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'dietary' ? -1 : 1
  );

// Filter pages for cities that have NO city hub (below the ≥10 rule), grouped by
// county — so the county hub can surface them and they aren't orphaned.
export function orphanCityFiltersForCounty(countySlug) {
  const groups = [];
  for (const [cs, pages] of cityFilters) {
    if (cityHubSlugs.has(cs)) continue;
    if (pages[0]?.items[0]?.county_slug !== countySlug) continue;
    groups.push({ city: pages[0].geoName, citySlug: cs, pages: sortFilters(pages) });
  }
  return groups.sort((a, b) => a.city.localeCompare(b.city));
}

/* ============================================================================
 * Health-score "special" pages: hidden gems / top-rated-safe / worst-health.
 * Same phase-1 threshold as filter pages. hidden_gems yields 0 in phase 1
 * (the data lives in later phases) but is kept so it auto-builds then.
 * ========================================================================== */
const SPECIAL_MIN = 3;
const SPECIAL = {
  hidden_gems_city: { specialType: 'hidden_gems', geoType: 'city', label: 'Hidden Gems' },
  grade_a_city: { specialType: 'top_rated_safe', geoType: 'city', label: 'Top-Rated & Safe' },
  worst_offenders_county: { specialType: 'worst_health', geoType: 'county', label: 'Lowest Health Scores' },
};

function matchSpecial(pf) {
  return phase1.filter((r) => {
    if (pf.city_slug && r.city_slug !== pf.city_slug) return false;
    if (pf.county_slug && r.county_slug !== pf.county_slug) return false;
    if (pf.hidden_gem === 'true' && r.hidden_gem !== true) return false;
    if (pf.grade && r.health_grade !== pf.grade) return false;
    if (pf.grade_in && !pf.grade_in.split(',').includes(r.health_grade)) return false;
    return true;
  });
}

function enrichSpecial(r) {
  const meta = SPECIAL[r.type];
  const pf = parseFilter(r.filter);
  const geoType = meta.geoType;
  const geoSlug = geoType === 'county' ? pf.county_slug : pf.city_slug;
  const items = matchSpecial(pf);
  const sample = items[0];
  const geoName = !sample
    ? geoSlug
    : geoType === 'county'
      ? sample.county
      : titleCase(sample.city);
  return {
    type: r.type, specialType: meta.specialType, label: meta.label,
    url: r.url, geoType, geoSlug, geoName, items,
  };
}

export const specialPages = rows
  .filter((r) => SPECIAL[r.type] && r.phase === 1)
  .map(enrichSpecial)
  .filter((p) => p.items.length >= SPECIAL_MIN);

export const specialByCity = new Map();
export const specialByCounty = new Map();
for (const p of specialPages) {
  const m = p.geoType === 'county' ? specialByCounty : specialByCity;
  if (!m.has(p.geoSlug)) m.set(p.geoSlug, []);
  m.get(p.geoSlug).push(p);
}
