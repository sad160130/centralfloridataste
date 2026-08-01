// County-level FAILED-inspection aggregates for
// /[county]-county/failed-inspections/.
//
// SCOPE. Published set only, matching the sibling /restaurant-inspections/ page
// exactly. Every restaurant named here therefore has a live listing page to link
// to. The ONLY full-CSV figure that appears is the licensed-establishment count,
// used as a labelled coverage denominator — never as a finding.
//
// COUNTY FIELD. region4_master.csv has 28 rows where `county` disagrees with
// `county_slug`. Adjudicated against a city->county map built from the 5,969
// clean rows: 28/28 support county_slug, 0 support county. county_slug is
// authoritative, matching the shipped inspection pages.
//
// NR. Restaurants without a scoreable recent inspection carry health_grade "NR".
// They are excluded from grade distributions and from the failing lists, and the
// exclusion is stated on-page. `graded` is the denominator for every percentage.
//
// VIOLATION PRIORITY. DBPR's per-violation priority tier is NOT in our extract —
// each violation carries only {code, description, count}. Restaurant-level
// high-priority COUNTS (hp_violations) are available and are reported as such.
// We therefore rank "violations cited at failing restaurants" and label it that
// way, rather than asserting a high-priority classification the data cannot
// support.
import fs from 'node:fs';
import { phase1 } from './data.js';
import { VIOLATION_PLAIN } from './inspections.js';
import { titleCase, formatDate } from './format.js';

/* ---------- full-CSV licensed-establishment totals, for coverage only ---------- */
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
const csvRaw = fs.readFileSync(new URL('../../Data/region4_master.csv', import.meta.url), 'utf8');
const csvLines = csvRaw.split(/\r?\n/).filter(Boolean);
const csvHead = parseLine(csvLines[0]);
const iSlug = csvHead.indexOf('county_slug');
export const licensedByCounty = (() => {
  const m = new Map();
  for (let i = 1; i < csvLines.length; i++) {
    const slug = parseLine(csvLines[i])[iSlug];
    if (slug) m.set(slug, (m.get(slug) || 0) + 1);
  }
  return m;
})();

const GRADES = ['A', 'B', 'C', 'D', 'F'];
const isEmergencyDisp = (d) => /emergency order/i.test(d || '');

/** Everything the failed-inspections page renders, for one county slug. */
export function countyFailureStats(countySlug) {
  const items = phase1.filter((r) => r.county_slug === countySlug);
  if (!items.length) return null;

  // Name from the majority value, not items[0] — the mismatched rows carry a
  // wrong `county` string and must not be allowed to name the page.
  const nameCounts = new Map();
  for (const r of items) nameCounts.set(r.county, (nameCounts.get(r.county) || 0) + 1);
  const countyName = [...nameCounts].sort((a, b) => b[1] - a[1])[0][0];

  const graded = items.filter((r) => GRADES.includes(r.health_grade));
  const nr = items.length - graded.length;
  const counts = Object.fromEntries(GRADES.map((g) => [g, graded.filter((r) => r.health_grade === g).length]));
  const fCount = counts.F;
  const dCount = counts.D;
  const failing = fCount + dCount;

  const pctOf = (n) => (graded.length ? Math.round((n / graded.length) * 1000) / 10 : 0);

  /* --- emergency-order restaurants --- */
  const emergency = items
    .filter((r) => r.emergency_flag === true)
    .map((r) => {
      const hist = [...(r.inspection_history || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
      const ord = hist.find((h) => isEmergencyDisp(h.disposition)) || hist[0] || {};
      return {
        name: r.name,
        url: r.url,
        city: titleCase(r.city),
        grade: r.health_grade,
        score: Number.isFinite(r.health_score) ? r.health_score : null,
        date: ord.date || r.latest_inspection_date || null,
        dateText: formatDate(ord.date || r.latest_inspection_date) || null,
        disposition: ord.disposition || null,
        high: ord.high ?? r.hp_violations ?? 0,
        intermediate: ord.intermediate ?? r.intermediate_violations ?? 0,
        basic: ord.basic ?? r.basic_violations ?? 0,
      };
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  /* --- F then D, worst score first --- */
  const rank = (r) => ({
    name: r.name,
    url: r.url,
    city: titleCase(r.city),
    grade: r.health_grade,
    score: Number.isFinite(r.health_score) ? r.health_score : null,
    high: r.hp_violations || 0,
    intermediate: r.intermediate_violations || 0,
    basic: r.basic_violations || 0,
    total: (r.hp_violations || 0) + (r.intermediate_violations || 0) + (r.basic_violations || 0),
    date: r.latest_inspection_date || null,
    dateText: formatDate(r.latest_inspection_date) || null,
    emergency: r.emergency_flag === true,
  });
  const byScore = (a, b) => (a.score ?? 999) - (b.score ?? 999) || b.high - a.high;
  const fList = graded.filter((r) => r.health_grade === 'F').map(rank).sort(byScore);
  const dList = graded.filter((r) => r.health_grade === 'D').map(rank).sort(byScore);

  /* --- violations cited AT failing restaurants (F/D), ranked --- */
  const failingRows = graded.filter((r) => r.health_grade === 'F' || r.health_grade === 'D');
  const vmap = new Map();
  let vTotal = 0;
  for (const r of failingRows) {
    for (const h of r.inspection_history || []) {
      for (const v of h.violations || []) {
        const n = v.count || 1;
        vTotal += n;
        const cur = vmap.get(v.code) || { code: v.code, official: v.description, count: 0, sites: new Set() };
        cur.count += n;
        cur.sites.add(r.license_key);
        vmap.set(v.code, cur);
      }
    }
  }
  const violations = [...vmap.values()]
    .sort((a, b) => b.count - a.count || String(a.code).localeCompare(String(b.code)))
    .map((v) => ({
      code: v.code,
      official: v.official,
      plain: VIOLATION_PLAIN[v.code] || null,
      count: v.count,
      sites: v.sites.size,
      pctOfFailing: failingRows.length ? Math.round((v.sites.size / failingRows.length) * 100) : 0,
    }));

  // Restaurant-level high-priority totals — a real DBPR field, unlike per-code priority.
  const hpTotal = failingRows.reduce((s, r) => s + (r.hp_violations || 0), 0);
  const hpSites = failingRows.filter((r) => (r.hp_violations || 0) > 0).length;

  return {
    slug: countySlug,
    countyName,
    published: items.length,
    licensed: licensedByCounty.get(countySlug) ?? null,
    graded: graded.length,
    nr,
    counts,
    fCount,
    dCount,
    failing,
    pctF: pctOf(fCount),
    pctD: pctOf(dCount),
    pctFailing: pctOf(failing),
    emergency,
    emergencyCount: emergency.length,
    pctEmergency: items.length ? Math.round((emergency.length / items.length) * 1000) / 10 : 0,
    fList,
    dList,
    violations,
    violationTotal: vTotal,
    hpTotal,
    hpSites,
  };
}

/** All counties with stats, largest published set first. */
export function allCountyFailures() {
  const seen = new Set();
  for (const r of phase1) seen.add(r.county_slug);
  return [...seen]
    .map((s) => countyFailureStats(s))
    .filter(Boolean)
    .sort((a, b) => b.published - a.published);
}
