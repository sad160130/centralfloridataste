#!/usr/bin/env node
/**
 * Visual-semantics checks — run against BUILT pages in dist/.
 *
 *   node .claude/skills/visual-semantics/check.mjs                # whole site
 *   node .claude/skills/visual-semantics/check.mjs --pages f.txt  # only these URLs (one per line)
 *   node .claude/skills/visual-semantics/check.mjs --json         # machine-readable summary
 *
 * Exits 1 if any rule fails. Rule numbers match SKILL.md.
 */
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const pagesArg = args.includes('--pages') ? args[args.indexOf('--pages') + 1] : null;
const asJson = args.includes('--json');
const DIST = 'dist';

/* thresholds — calibrated against the known-good production build */
const VERDICT_WINDOW = 200; // query-answering sentence must start inside this
const CENTERPIECE = 400; // the block a search engine is likely to extract
const UNIQUE_MIN = 0.40; // ≥40% of centerpiece tokens must not be sitewide boilerplate
const BOILERPLATE_DF = 0.5; // a token on >50% of pages counts as boilerplate

const BANNED = [
  [/Photo:/, 'photo credit'],
  [/This grade is calculated/, 'DBPR disclaimer'],
  [/Data last updated/, '"last updated" line'],
];

const walk = (d, a = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, a);
    else if (e.name.endsWith('.html')) a.push(p);
  }
  return a;
};
const toUrl = (f) => '/' + f.split(path.sep).join('/').replace(new RegExp(`^${DIST}/`), '').replace(/index\.html$/, '');
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();
const mainOf = (h) => (h.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || [, ''])[1];
const ldOf = (h) =>
  [...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].flatMap((m) => {
    try { const j = JSON.parse(m[1]); return Array.isArray(j) ? j : [j]; } catch { return ['__BAD__']; }
  });

const kind = (u) => {
  if (u === '/') return 'homepage';
  if (u.startsWith('/restaurant/')) return 'detail';
  if (/^\/404/.test(u)) return '404';
  if (/^\/(about|methodology|data-sources)\/$/.test(u)) return 'trust';
  if (/\/(top-rated-safe|worst-health-scores|hidden-gems)\/$/.test(u)) return 'special';
  if (/-county\/$/.test(u)) return 'county';
  if (u.startsWith('/neighborhood/')) return u.split('/').filter(Boolean).length > 2 ? 'filter' : 'district';
  const seg = u.split('/').filter(Boolean);
  if (seg.length === 2) return 'filter';
  if (seg.length === 1) return 'city-or-report'; // disambiguated by JSON-LD type
  return 'report';
};
// Narrative pages answer with prose, not a metric — exempt from the numeric
// verdict signal (the boilerplate ban below still applies to them).
const NARRATIVE = new Set(['trust']);

/* ---------------- gather ---------------- */
let files = walk(DIST);
if (pagesArg) {
  const want = new Set(
    fs.readFileSync(pagesArg, 'utf8').split(/\r?\n/).filter(Boolean)
      .map((s) => s.trim().replace(/index\.html$/, '').replace(/\/?$/, '/'))
  );
  files = files.filter((f) => want.has(toUrl(f)));
}
files = files.filter((f) => kind(toUrl(f)) !== '404'); // noindex utility page

const pages = files.map((f) => {
  const html = fs.readFileSync(f, 'utf8');
  const mn = mainOf(html);
  const text = strip(mn.replace(/<nav\b[\s\S]*?<\/nav>/gi, ' '));
  return { url: toUrl(f), kind: kind(toUrl(f)), html, mn, window: text.slice(0, CENTERPIECE), head: text.slice(0, VERDICT_WINDOW) };
});

const fail = { r1: [], r2: [], r3: [], r4: [] };

/* ---- Rule 1: verdict leads the centerpiece ---- */
for (const p of pages) {
  if (!NARRATIVE.has(p.kind)) {
    // Strongest signal: the grade placard opening the page ("A 97", or "NR" for
    // an unrated kitchen). Otherwise a metric plus a domain term.
    const placard = /^(NR\b|[ABCDF]\s+\d{1,3}\b)/.test(p.head);
    const prose =
      /\d/.test(p.head) &&
      /(grade|clean|health|kitchen|score|violation|inspect|restaurant|rated|safe|star|diner|review)/i.test(p.head);
    if (!placard && !prose) fail.r1.push(`${p.url} — no query-answering signal in first ${VERDICT_WINDOW} chars`);
  }
  for (const [re, what] of BANNED) if (re.test(p.window)) fail.r1.push(`${p.url} — ${what} inside first ${CENTERPIECE} chars`);
}

/* ---- Rule 2: primary verdict in structured data ---- */
for (const p of pages) {
  const ld = ldOf(p.html);
  if (ld.includes('__BAD__')) { fail.r2.push(`${p.url} — unparseable JSON-LD`); continue; }
  const types = ld.map((n) => n['@type']);
  if (p.kind === 'detail') {
    const node = ld.find((n) => n['@type'] === 'Restaurant');
    if (!node) { fail.r2.push(`${p.url} — no Restaurant node`); continue; }
    const graded = (node.additionalProperty || []).some(
      (x) => x?.name === 'Calculated health grade' && /^[A-F]$/.test(String(x.value))
    );
    const rev = node.review;
    if (graded && !rev) fail.r2.push(`${p.url} — graded but no health Review`);
    if (!graded && rev) fail.r2.push(`${p.url} — unrated but emits a health Review`);
    if (rev) {
      const rr = rev.reviewRating || {};
      if (rev['@type'] !== 'Review' || rr['@type'] !== 'Rating') fail.r2.push(`${p.url} — health review is not Review/Rating`);
      if (!rev.author?.['@id']) fail.r2.push(`${p.url} — health Review not authored by the publisher Organization`);
      if (rr.bestRating !== 100 || rr.worstRating !== 0) fail.r2.push(`${p.url} — health Rating is not an explicit 0–100 scale`);
      if (!/Grade [A-F]/.test(rr.alternateName || '')) fail.r2.push(`${p.url} — health Rating carries no A–F letter`);
      if (!/does not issue official|[Nn]ot an official/.test(`${rev.reviewBody || ''} ${rr.ratingExplanation || ''}`))
        fail.r2.push(`${p.url} — health Review missing calculated-not-official framing`);
      if (node.aggregateRating && node.aggregateRating.bestRating === rr.bestRating)
        fail.r2.push(`${p.url} — health rating not distinct from diner aggregateRating`);
    }
  } else if (types.includes('CollectionPage')) {
    // A page that declares itself a collection must enumerate what it collects.
    if (!JSON.stringify(ld).includes('"ItemList"')) fail.r2.push(`${p.url} — CollectionPage with no ItemList`);
  } else if (!types.some((t) => t && t !== 'Organization')) {
    fail.r2.push(`${p.url} — no page-level JSON-LD type`);
  }
}

/* ---- Rule 3: every functional block is named ---- */
for (const p of pages) {
  const unnamed = [...p.mn.matchAll(/<section\b([^>]*)>/gi)].filter((m) => !/aria-label(ledby)?=/.test(m[1]));
  if (unnamed.length) fail.r3.push(`${p.url} — ${unnamed.length} unnamed <section>`);
  const i = p.mn.search(/<ul class="cards"/i);
  if (i !== -1 && !/<h2\b/i.test(p.mn.slice(Math.max(0, i - 400), i)))
    fail.r3.push(`${p.url} — primary card list has no heading`);
}

/* ---- Rule 4: first 400 chars are page-unique ---- */
const tok = (s) => [...new Set(s.toLowerCase().match(/[a-z]{4,}/g) || [])];
const df = new Map();
for (const p of pages) for (const t of tok(p.window)) df.set(t, (df.get(t) || 0) + 1);
const N = pages.length || 1;
for (const p of pages) {
  const ts = tok(p.window);
  if (!ts.length) { fail.r4.push(`${p.url} — empty centerpiece`); continue; }
  const uniq = ts.filter((t) => (df.get(t) || 0) / N <= BOILERPLATE_DF).length / ts.length;
  if (uniq < UNIQUE_MIN)
    fail.r4.push(`${p.url} — only ${(uniq * 100).toFixed(0)}% page-unique tokens (min ${UNIQUE_MIN * 100}%)`);
}

/* ---------------- report ---------------- */
const RULES = [
  ['r1', 'Verdict leads the centerpiece'],
  ['r2', 'Primary verdict in structured data'],
  ['r3', 'Every functional block is named'],
  ['r4', 'First 400 chars are page-unique'],
];
const total = Object.values(fail).reduce((s, a) => s + a.length, 0);

if (asJson) {
  console.log(JSON.stringify({ pages: pages.length, failures: total, rules: Object.fromEntries(RULES.map(([k, t]) => [k, { title: t, failures: fail[k] }])) }, null, 2));
} else {
  console.log(`visual-semantics — ${pages.length} built page(s) checked\n`);
  for (const [k, title] of RULES) {
    const n = fail[k].length;
    console.log(`  ${n === 0 ? 'PASS' : 'FAIL'}  ${k.toUpperCase()}  ${title}${n ? `  (${n})` : ''}`);
    fail[k].slice(0, 10).forEach((m) => console.log(`          ${m}`));
    if (n > 10) console.log(`          …and ${n - 10} more`);
  }
  console.log(`\n${total === 0 ? 'ALL RULES PASS' : `${total} FAILURE(S) — fix before deploying`}`);
}
process.exit(total === 0 ? 0 : 1);
