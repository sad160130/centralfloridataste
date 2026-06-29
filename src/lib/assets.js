// ---------------------------------------------------------------------------
// Signature-asset datasets. Every number here is computed at build time from
// the published DBPR records — nothing is invented. Pages import these so the
// creativity lives in framing/visual treatment, never in the facts.
// ---------------------------------------------------------------------------
import restaurants from '../data/restaurants.json';
import { districts } from './data.js';
import { titleCase } from './format.js';

const pub = restaurants.filter((r) => r.published === true);
const G = (r) => String(r.health_grade || '').toUpperCase();

export const SOURCE = 'Florida DBPR public inspection records';
export const AS_OF = 'June 2026';

function statsOf(items) {
  const n = items.length;
  const c = { A: 0, B: 0, C: 0, D: 0, F: 0, NR: 0 };
  let sum = 0, sn = 0;
  for (const r of items) {
    const g = G(r);
    if (c[g] !== undefined) c[g]++;
    if (Number.isFinite(r.health_score)) { sum += r.health_score; sn++; }
  }
  return {
    n, A: c.A, B: c.B, C: c.C, D: c.D, F: c.F, NR: c.NR,
    pctA: n ? Math.round((c.A / n) * 100) : 0,
    riskPct: n ? Math.round(((c.D + c.F) / n) * 100) : 0,
    avg: sn ? +(sum / sn).toFixed(1) : null,
  };
}
const shape = (r) => ({
  name: r.name, url: r.url, city: titleCase(r.city), county: r.county,
  rating: Number.isFinite(r.rating) ? r.rating : null,
  reviews: Number.isFinite(r.reviews_count) ? r.reviews_count : null,
  grade: G(r), score: Number.isFinite(r.health_score) ? r.health_score : null,
  hp: r.hp_violations || 0, int: r.intermediate_violations || 0, basic: r.basic_violations || 0,
  date: r.latest_inspection_date || null,
});

export const regionStats = statsOf(pub);

// === 1. LOVED BUT FAILING — rating >= 4.5 AND grade D/F, widest gap first ===
export const lovedButFailing = pub
  .filter((r) => ['D', 'F'].includes(G(r)) && Number.isFinite(r.rating) && r.rating >= 4.5 && Number.isFinite(r.health_score))
  .map((r) => ({ ...shape(r), gap: Math.round(r.rating * 20 - r.health_score) }))
  .sort((a, b) => b.gap - a.gap || a.score - b.score || (b.reviews || 0) - (a.reviews || 0));
export const lovedButFailingStats = {
  count: lovedButFailing.length,
  f: lovedButFailing.filter((x) => x.grade === 'F').length,
  d: lovedButFailing.filter((x) => x.grade === 'D').length,
  worst: lovedButFailing[0] || null,
  mostReviewed: [...lovedButFailing].sort((a, b) => (b.reviews || 0) - (a.reviews || 0))[0] || null,
};

// === 2. SAFETY HEATMAP — county + district grade matrix ===
export const countyMatrix = Object.values(
  pub.reduce((acc, r) => {
    const k = r.county_slug || '—'; // group by slug to match the county hubs/homepage
    (acc[k] ??= { county: r.county, slug: r.county_slug, items: [] }).items.push(r);
    return acc;
  }, {})
).map(({ county, slug, items }) => ({ county, slug, ...statsOf(items) }))
  .sort((a, b) => b.pctA - a.pctA || (b.avg || 0) - (a.avg || 0));

export const districtMatrix = districts
  .map((d) => ({ name: d.name, slug: d.slug, ...statsOf(d.items) }))
  .sort((a, b) => b.pctA - a.pctA || (b.avg || 0) - (a.avg || 0));

// === 3. DISNEY PARADOX — the two cities that make up Walt Disney World ===
const inCities = (names) => pub.filter((r) => names.includes(titleCase(r.city)));
export const disney = {
  bayLake: {
    ...statsOf(inCities(['Bay Lake'])),
    items: inCities(['Bay Lake']).map(shape).sort((a, b) => (b.score || 0) - (a.score || 0) || (b.reviews || 0) - (a.reviews || 0)),
  },
  lbv: statsOf(inCities(['Lake Buena Vista'])),
  corridor: statsOf(inCities(['Bay Lake', 'Lake Buena Vista'])),
  region: regionStats,
};

// === 4. CUISINE RANKING — cleanest to riskiest (min 20 graded) ===
export const cuisineRanking = Object.values(
  pub.reduce((acc, r) => {
    if (!r.cuisine || r.cuisine === 'other') return acc;
    (acc[r.cuisine] ??= { cuisine: r.cuisine, items: [] }).items.push(r);
    return acc;
  }, {})
).filter((c) => c.items.length >= 20)
  .map(({ cuisine, items }) => ({ cuisine: titleCase(cuisine), ...statsOf(items) }))
  .sort((a, b) => (b.avg || 0) - (a.avg || 0)); // cleanest first

// === 5. TRAJECTORIES — per-inspection violation series (the site's own weights) ===
const weighted = (h) => 8 * (h.high || 0) + 3 * (h.intermediate || 0) + 1 * (h.basic || 0);
const trajData = pub.map((r) => {
  const hist = (r.inspection_history || []).filter((h) => h.date).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (hist.length < 2) return null;
  const series = hist.map((h) => ({ date: h.date, hp: h.high || 0, int: h.intermediate || 0, basic: h.basic || 0, w: weighted(h) }));
  const firstW = series[0].w, lastW = series[series.length - 1].w;
  return { ...shape(r), visits: series.length, series, first: series[0], last: series[series.length - 1], improvement: firstW - lastW };
}).filter(Boolean);
// Require the endpoint grade to match the arc so the placard agrees with the
// trajectory (a "comeback" that's still a D would read as a contradiction).
export const comebacks = [...trajData].filter((t) => t.improvement > 0 && ['A', 'B'].includes(t.grade)).sort((a, b) => b.improvement - a.improvement).slice(0, 8);
export const collapses = [...trajData].filter((t) => t.improvement < 0 && ['D', 'F'].includes(t.grade)).sort((a, b) => a.improvement - b.improvement).slice(0, 8);
// shared scale for sparkline bar heights
export const trajMaxW = Math.max(1, ...[...comebacks, ...collapses].flatMap((t) => t.series.map((s) => s.w)));

// === 6. EMERGENCY ORDERS — strongest DBPR enforcement action ===
export const emergencyOrders = pub
  .filter((r) => (r.inspection_history || []).some((h) => /emergency/i.test(h.disposition || '')))
  .map((r) => {
    const emo = (r.inspection_history || [])
      .filter((h) => /emergency/i.test(h.disposition || ''))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    return { ...shape(r), emoDisposition: emo.disposition, emoDate: emo.date };
  })
  .sort((a, b) => String(b.emoDate).localeCompare(String(a.emoDate)));
export const emergencyByCounty = Object.entries(
  emergencyOrders.reduce((acc, r) => { acc[r.county] = (acc[r.county] || 0) + 1; return acc; }, {})
).map(([county, n]) => ({ county, n })).sort((a, b) => b.n - a.n);

// shared report metadata (title, blurb, accent) for cross-linking
export const REPORTS = [
  { url: '/loved-but-failing/', kicker: 'Flagship', title: 'Loved but Failing', blurb: 'Great reviews, failing grades — the rating-vs-safety gap, widest first.' },
  { url: '/safety-map/', kicker: 'Reference', title: 'The Safety Map', blurb: 'Every county graded, cleanest to riskiest.' },
  { url: '/disney-cleanest/', kicker: 'Counterintuitive', title: 'The Disney Paradox', blurb: 'The cleanest kitchens in Central Florida are inside Walt Disney World.' },
  { url: '/cuisines-ranked/', kicker: 'Counterintuitive', title: 'Cuisines, Ranked', blurb: 'Which cuisines grade cleanest — and which really don’t.' },
  { url: '/comebacks-and-collapses/', kicker: 'Trajectories', title: 'Comebacks & Collapses', blurb: 'The biggest health turnarounds and freefalls on record.' },
  { url: '/emergency-orders/', kicker: 'Enforcement', title: 'Emergency Orders', blurb: 'Where the state took its strongest action.' },
];
