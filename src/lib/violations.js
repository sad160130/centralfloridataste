// Violation-tier aggregates for the /violations/ cluster.
//
// SCOPE. Published set only, county_slug authoritative, NR excluded from grade
// percentages — identical to the shipped county pages, so every figure here
// reconciles with them. Every restaurant named has a live listing page.
//
// TIER SOURCE. hp_violations / intermediate_violations / basic_violations are
// real per-restaurant fields on the latest inspection, and all tier counts and
// distributions come from them. The ranked violation CODES on the hub come from
// restaurants.json inspection_history, which carries the per-visit records the
// CSV flattens away.
//
// WHAT WE DELIBERATELY DO NOT CLAIM. The extract carries no priority tier per
// violation code — a code is never marked high-priority, intermediate or basic.
// So the tier pages report tier COUNTS and distributions, which are real fields,
// and never assert that a particular code belongs to a tier.
import { phase1 } from './data.js';
import { VIOLATION_PLAIN } from './inspections.js';
import { licensedByCounty } from './failed-inspections.js';
import { titleCase, formatDate } from './format.js';

export const TIERS = {
  'high-priority': {
    slug: 'high-priority',
    field: 'hp_violations',
    label: 'High-priority',
    title: 'High-Priority Violations',
    penalty: 8,
    // Plain English. The competing results quote the statute; this does not.
    what:
      'A high-priority violation is one an inspector judges likely to cause foodborne illness directly — food held at unsafe temperatures, raw meat stored above ready-to-eat food, staff handling food without washing their hands, or live pests in the kitchen.',
    why:
      'These are the findings that can make someone ill from a single meal, rather than problems that degrade a kitchen over time. They carry the heaviest deduction in our score: 8 points each.',
    fix:
      'Most are correctable on the spot, and inspectors routinely record them as corrected during the visit. Where they are not, the inspector can require a callback inspection or, in the most serious cases, recommend an emergency order.',
  },
  intermediate: {
    slug: 'intermediate',
    field: 'intermediate_violations',
    label: 'Intermediate',
    title: 'Intermediate Violations',
    penalty: 3,
    what:
      'An intermediate violation is one that makes a high-priority failure more likely, without being an immediate hazard itself — a missing thermometer, no certified food manager on staff, or a handwash sink without soap.',
    why:
      'They describe a kitchen whose safeguards are missing rather than a kitchen actively serving unsafe food. In our score each one deducts 3 points.',
    fix:
      'They are usually resolved by restocking, repair or paperwork, and often clear by the next routine visit.',
  },
  basic: {
    slug: 'basic',
    field: 'basic_violations',
    label: 'Basic',
    title: 'Basic Violations',
    penalty: 1,
    what:
      'A basic violation is a maintenance or housekeeping problem — dirty floors, walls or ceilings, a damaged work surface, uncovered rubbish, or storage that has been allowed to slide.',
    why:
      'On their own they are not a direct route to illness, which is why each deducts only 1 point. In volume they describe a kitchen that is not being kept up, and they are by far the most commonly recorded of the three tiers.',
    fix:
      'They are cleaning and repair items. A restaurant can carry several and still hold an A.',
  },
};

const num = (n) => n || 0;

/** Sitewide coverage: published vs licensed establishments. */
export function coverage() {
  let licensed = 0;
  for (const v of licensedByCounty.values()) licensed += v;
  const graded = phase1.filter((r) => ['A', 'B', 'C', 'D', 'F'].includes(r.health_grade)).length;
  return {
    published: phase1.length,
    licensed,
    counties: new Set(phase1.map((r) => r.county_slug)).size,
    graded,
    nr: phase1.length - graded,
  };
}

/** Everything one tier page renders. */
export function tierStats(tierSlug) {
  const t = TIERS[tierSlug];
  if (!t) return null;
  const f = t.field;

  const total = phase1.reduce((s, r) => s + num(r[f]), 0);
  const withAny = phase1.filter((r) => num(r[f]) > 0);
  const max = phase1.reduce((m, r) => Math.max(m, num(r[f])), 0);

  // Distribution buckets — how concentrated is this tier?
  const buckets = [
    { label: 'None', test: (n) => n === 0 },
    { label: '1', test: (n) => n === 1 },
    { label: '2', test: (n) => n === 2 },
    { label: '3 to 5', test: (n) => n >= 3 && n <= 5 },
    { label: '6 or more', test: (n) => n >= 6 },
  ].map((b) => {
    const c = phase1.filter((r) => b.test(num(r[f]))).length;
    return { label: b.label, count: c, pct: Math.round((c / phase1.length) * 1000) / 10 };
  });

  const byCounty = [...new Set(phase1.map((r) => r.county_slug))]
    .map((slug) => {
      const rs = phase1.filter((r) => r.county_slug === slug);
      const nameCounts = new Map();
      for (const r of rs) nameCounts.set(r.county, (nameCounts.get(r.county) || 0) + 1);
      const name = [...nameCounts].sort((a, b) => b[1] - a[1])[0][0];
      const tot = rs.reduce((s, r) => s + num(r[f]), 0);
      return {
        slug,
        name,
        restaurants: rs.length,
        total: tot,
        per100: Math.round((tot / rs.length) * 100) / 100,
        affected: rs.filter((r) => num(r[f]) > 0).length,
      };
    })
    .sort((a, b) => b.per100 - a.per100);

  const worst = [...withAny]
    .sort((a, b) => num(b[f]) - num(a[f]) || (a.health_score ?? 999) - (b.health_score ?? 999))
    .slice(0, 12)
    .map((r) => ({
      name: r.name,
      url: r.url,
      city: titleCase(r.city),
      county: r.county,
      count: num(r[f]),
      grade: r.health_grade,
      score: Number.isFinite(r.health_score) ? r.health_score : null,
      high: num(r.hp_violations),
      intermediate: num(r.intermediate_violations),
      basic: num(r.basic_violations),
      date: r.latest_inspection_date,
      dateText: formatDate(r.latest_inspection_date),
    }));

  return {
    ...t,
    total,
    affected: withAny.length,
    pctAffected: Math.round((withAny.length / phase1.length) * 1000) / 10,
    clean: phase1.length - withAny.length,
    max,
    avgPerRestaurant: Math.round((total / phase1.length) * 100) / 100,
    buckets,
    byCounty,
    worst,
  };
}

/** All three tiers, for the hub's comparison table. */
export function allTiers() {
  return Object.keys(TIERS).map((k) => {
    const s = tierStats(k);
    return { slug: s.slug, label: s.label, title: s.title, penalty: s.penalty, total: s.total, affected: s.affected, pctAffected: s.pctAffected };
  });
}

/** Ranked violation CODES across the published set (from inspection_history). */
export function rankedCodes(limit = 20) {
  const m = new Map();
  let total = 0;
  for (const r of phase1) {
    for (const h of r.inspection_history || []) {
      for (const v of h.violations || []) {
        const n = v.count || 1;
        total += n;
        const cur = m.get(v.code) || { code: v.code, official: v.description, count: 0, sites: new Set() };
        cur.count += n;
        cur.sites.add(r.license_key);
        m.set(v.code, cur);
      }
    }
  }
  const rows = [...m.values()]
    .sort((a, b) => b.count - a.count || String(a.code).localeCompare(String(b.code)))
    .map((v) => ({
      code: v.code,
      official: v.official,
      plain: VIOLATION_PLAIN[v.code] || null,
      count: v.count,
      sites: v.sites.size,
      pctSites: Math.round((v.sites.size / phase1.length) * 1000) / 10,
    }));
  return { total, distinct: rows.length, rows: rows.slice(0, limit) };
}

/** Emergency-order restaurants, grouped by county. */
export function emergencyStats() {
  const flagged = phase1.filter((r) => r.emergency_flag === true);
  const byCounty = [...new Set(flagged.map((r) => r.county_slug))]
    .map((slug) => {
      const rs = flagged.filter((r) => r.county_slug === slug);
      const nameCounts = new Map();
      for (const r of phase1.filter((x) => x.county_slug === slug)) nameCounts.set(r.county, (nameCounts.get(r.county) || 0) + 1);
      const name = [...nameCounts].sort((a, b) => b[1] - a[1])[0][0];
      return {
        slug,
        name,
        countyTotal: phase1.filter((r) => r.county_slug === slug).length,
        items: rs
          .map((r) => {
            const hist = [...(r.inspection_history || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
            const ord = hist.find((h) => /emergency order/i.test(h.disposition || '')) || hist[0] || {};
            return {
              name: r.name,
              url: r.url,
              city: titleCase(r.city),
              grade: r.health_grade,
              score: Number.isFinite(r.health_score) ? r.health_score : null,
              date: ord.date || r.latest_inspection_date,
              dateText: formatDate(ord.date || r.latest_inspection_date),
              disposition: ord.disposition || null,
            };
          })
          .sort((a, b) => String(b.date).localeCompare(String(a.date))),
      };
    })
    .sort((a, b) => b.items.length - a.items.length);

  // How many emergency orders ended in a clean callback vs still open.
  let complied = 0, notComplied = 0, extension = 0, recommended = 0;
  for (const r of flagged) {
    const disps = (r.inspection_history || []).map((h) => h.disposition || '');
    if (disps.some((d) => /Emergency Order Callback Complied/i.test(d))) complied++;
    else if (disps.some((d) => /Callback Not Complied/i.test(d))) notComplied++;
    else if (disps.some((d) => /Callback Time Extension/i.test(d))) extension++;
    else recommended++;
  }

  return { total: flagged.length, byCounty, complied, notComplied, extension, recommended };
}
