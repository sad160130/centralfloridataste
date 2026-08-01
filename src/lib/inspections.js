// County-level inspection aggregates for /[county]-county/restaurant-inspections/.
//
// SOURCE NOTE. The brief specified region4_master.csv, and that file supplies the
// restaurant roster, grades, dispositions and emergency flags. It carries only ONE
// row per restaurant (its latest inspection) and only three aggregate violation
// counts (high-priority / intermediate / basic) — no violation codes, no
// descriptions, no inspection history. So two of the required blocks — total
// inspections with a real date range, and ranked violations with explanations —
// are computed from restaurants.json's `inspection_history[]`, which is the same
// DBPR extract carrying the per-visit records the CSV flattens away.
//
// Scope: PUBLISHED restaurants only, matching every other page on the site. Using
// the full roster would make this page contradict its own county hub and would
// name restaurants that have no detail page to link to.
import { phase1 } from './data.js';
import { titleCase, formatDate } from './format.js';

// DBPR writes violations as regulatory strings. These are our plain-English
// readings of what each one actually means for a diner — the code and the
// official wording are shown alongside, so nothing is obscured.
const VIOLATION_PLAIN = {
  '36': 'Floors, walls or ceilings were dirty or in disrepair, or ventilation was inadequate — a housekeeping failure rather than a direct food risk.',
  '14': 'Equipment or work surfaces were damaged, worn or built in a way that cannot be properly cleaned.',
  '22': 'Surfaces that touch food were not clean and sanitised — one of the most direct routes to contamination.',
  '08': 'Raw and ready-to-eat foods were not kept apart, or food was left unprotected during prep or storage — the classic cross-contamination failure.',
  '31': 'A handwash sink was blocked, or missing soap, towels or its required sign, so staff could not wash hands properly.',
  '23': 'Surfaces that do not touch food directly — shelving, cabinet exteriors, equipment housings — were dirty.',
  '03': 'Food was held, cooked, cooled or reheated outside safe temperatures. This is the violation most often linked to foodborne illness.',
  '29': 'Plumbing faults: leaks, missing backflow prevention, or a mop sink problem.',
  '16': 'The dishwashing setup fell short — sanitiser strength untested, missing test kits, or faulty gauges.',
  '35': 'Evidence of insects or rodents, or gaps in the building that let pests in.',
  '10': 'Scoops and serving utensils were stored where they could pick up contamination between uses.',
  '53': 'Required food-manager certification or employee food-safety training was missing or out of date.',
  '02': 'Ready-to-eat food lacked required date marking or labelling, or a consumer advisory was missing.',
  '01': 'Food came from an unapproved source, or was spoiled, damaged or otherwise unsound.',
  '24': 'Clean equipment and utensils were stored or air-dried improperly, risking re-contamination.',
  '12': 'Staff handwashing was inadequate, or eating, drinking or smoking happened where it should not.',
  '41': 'Cleaning chemicals or other toxic substances were stored or used unsafely near food.',
  '21': 'Wiping cloths or linens were dirty, or stored outside sanitiser between uses.',
  '13': 'Staff clothing, hair restraints, jewellery or fingernails did not meet hygiene requirements.',
  '33': 'Garbage handling or the general upkeep of the premises fell below standard.',
  '40': 'Employees’ personal belongings were stored where they could contaminate food or equipment.',
  '25': 'Single-use items — cups, lids, containers — were stored or handled in a way that could contaminate them.',
  '51': 'A general sanitary or safe-operation condition not covered by a more specific code.',
  '32': 'A bathroom problem: cleanliness, supplies, or a door that should self-close.',
  '50': 'The establishment licence was missing, expired or not displayed.',
  '06': 'Frozen food was thawed by an unsafe method, such as at room temperature.',
  '05': 'Thermometers for food or equipment were missing, broken or inaccurate, so temperatures could not be verified.',
  '11': 'Employee health rules were not followed — including an ill employee present, or missing knowledge of reporting duties.',
  '27': 'A water supply problem: unsafe source, or hot or cold water not available under pressure.',
  '42': 'Cleaning equipment itself — mops, buckets, storage — was inadequate or poorly kept.',
  '38': 'Lighting was insufficient, or bulbs were unshielded where glass could fall into food.',
  '28': 'Sewage or waste water was not disposed of properly.',
  '46': 'An exit was blocked or locked. Recorded for reporting only; it does not affect the health score.',
  '52': 'Food or the business was misrepresented or misbranded.',
  '09': 'Staff touched ready-to-eat food with bare hands where gloves or utensils were required.',
  '45': 'Fire extinguishing equipment issue. Recorded for reporting only.',
  '47': 'Electrical wiring or outlets in poor repair. Recorded for reporting only.',
  '48': 'A gas appliance or boiler certificate issue. Recorded for reporting only.',
  '55': 'Automatic gratuity was not disclosed as required.',
  '49': 'Flammable or combustible materials stored improperly. Recorded for reporting only.',
  '04': 'Facilities were not capable of holding food at the required temperature.',
  '07': 'Unwrapped or potentially hazardous food was re-served.',
  '54': 'A Florida Clean Indoor Air Act issue.',
};

// Dispositions that mean the visit ended in enforcement rather than a pass.
const isEnforcement = (d) => /emergency order|administrative complaint|admin\. complaint|administrative determination/i.test(d || '');
const isWarning = (d) => /warning issued/i.test(d || '');

/** Everything the county inspections page renders, for one county slug. */
export function countyInspectionStats(countySlug) {
  const items = phase1.filter((r) => r.county_slug === countySlug);
  if (!items.length) return null;

  const countyName = items[0].county;

  /* --- coverage + date range, across every inspection on file --- */
  let inspections = 0;
  const dates = [];
  for (const r of items) {
    for (const h of r.inspection_history || []) {
      inspections += 1;
      if (h.date) dates.push(h.date);
    }
  }
  dates.sort();

  /* --- grade distribution --- */
  const grades = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  let graded = 0;
  for (const r of items) {
    if (Object.prototype.hasOwnProperty.call(grades, r.health_grade)) {
      grades[r.health_grade] += 1;
      graded += 1;
    }
  }
  const gradeRows = ['A', 'B', 'C', 'D', 'F'].map((g) => ({
    grade: g,
    count: grades[g],
    pct: graded ? Math.round((grades[g] / graded) * 100) : 0,
  }));

  /* --- most recent enforcement actions (newest first) --- */
  const enforcement = [];
  for (const r of items) {
    for (const h of r.inspection_history || []) {
      if (!isEnforcement(h.disposition)) continue;
      enforcement.push({
        name: r.name,
        url: r.url,
        city: titleCase(r.city),
        date: h.date,
        dateText: formatDate(h.date) || h.date,
        disposition: h.disposition,
        grade: r.health_grade,
        score: r.health_score,
        emergency: /emergency/i.test(h.disposition || ''),
      });
    }
  }
  enforcement.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const warnings = items.reduce(
    (s, r) => s + (r.inspection_history || []).filter((h) => isWarning(h.disposition)).length,
    0
  );

  /* --- most common violations, ranked --- */
  const vmap = new Map();
  let violationTotal = 0;
  for (const r of items) {
    for (const h of r.inspection_history || []) {
      for (const v of h.violations || []) {
        const n = v.count || 1;
        violationTotal += n;
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
      pctOfAll: violationTotal ? Math.round((v.count / violationTotal) * 100) : 0,
      pctOfSites: items.length ? Math.round((v.sites.size / items.length) * 100) : 0,
    }));

  const cleanVisits = items.reduce(
    (s, r) => s + (r.inspection_history || []).filter((h) => !(h.violations || []).length).length,
    0
  );

  return {
    slug: countySlug,
    countyName,
    restaurants: items.length,
    inspections,
    dateFrom: dates[0] || null,
    dateTo: dates[dates.length - 1] || null,
    dateFromText: dates.length ? formatDate(dates[0]) : null,
    dateToText: dates.length ? formatDate(dates[dates.length - 1]) : null,
    graded,
    gradeRows,
    grades,
    pctA: graded ? Math.round((grades.A / graded) * 100) : 0,
    failing: grades.D + grades.F,
    enforcement,
    enforcementTotal: enforcement.length,
    warnings,
    violations,
    violationTotal,
    cleanVisits,
    avgInspections: items.length ? (inspections / items.length).toFixed(1) : '0',
  };
}

/** The 8 counties, each with its stats — drives getStaticPaths. */
export function allCountyInspections() {
  const seen = new Map();
  for (const r of phase1) if (!seen.has(r.county_slug)) seen.set(r.county_slug, r.county);
  return [...seen.keys()]
    .map((slug) => countyInspectionStats(slug))
    .filter(Boolean)
    .sort((a, b) => b.restaurants - a.restaurants);
}
