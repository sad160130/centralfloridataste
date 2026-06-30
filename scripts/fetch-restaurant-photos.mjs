// ---------------------------------------------------------------------------
// Reusable, resumable Places-photo pipeline → Vercel Blob.
//
//   node scripts/fetch-restaurant-photos.mjs            # all published
//   node scripts/fetch-restaurant-photos.mjs --limit 50 # smoke test
//   node scripts/fetch-restaurant-photos.mjs --force     # ignore 25-day cache
//
// Per published restaurant with a place_id:
//   1. Place Details (photos field only) → up to 4 photo refs + html_attributions.
//   2. REFINE: prefer a business/editorial-attributed photo over a random user
//      photo (rank, then fall back through the list). No photos → status:"none".
//   3. Fetch the chosen Place Photo (maxwidth=800) — reusing the local byte cache
//      when the pick is unchanged, so re-selection doesn't re-buy unchanged images.
//   4. Upload to Vercel Blob (access:"public", stable path) and record the
//      blob.vercel-storage.com URL + attribution + timestamp in the ledger.
//
// Idempotent + cached: a row that already has a blob_url and was fetched within
// TTL_DAYS is skipped (no billable call, no re-upload). Fully resumable.
// ---------------------------------------------------------------------------
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { put } from '@vercel/blob';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REST_PATH = join(ROOT, 'src/data/restaurants.json');
const LEDGER_PATH = join(ROOT, 'Data/photo_cache.json');
const PHOTO_DIR = join(ROOT, 'public/restaurant-photos'); // local byte cache (gitignored)
const MAXWIDTH = 800;
const TTL_DAYS = 25;
const CONCURRENCY = 8;
const DETAILS_COST = 0.017;
const PHOTO_COST = 0.007;

const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
const FORCE = args.includes('--force');

// --- secrets from .env (never logged) ---
const env = readFileSync(join(ROOT, '.env'), 'utf8');
const readEnv = (k) => (env.match(new RegExp(`^\\s*${k}\\s*=\\s*(.+?)\\s*$`, 'm')) || [])[1]?.replace(/^["']|["']$/g, '');
const key = readEnv('GOOGLE_MAPS_API_KEY');
const blobToken = readEnv('BLOB_READ_WRITE_TOKEN');
if (!key) { console.error('GOOGLE_MAPS_API_KEY missing in .env'); process.exit(1); }
if (!blobToken) { console.error('BLOB_READ_WRITE_TOKEN missing in .env'); process.exit(1); }

const restaurants = JSON.parse(readFileSync(REST_PATH, 'utf8'));
const targets = restaurants.filter((r) => r.published === true && r.place_id && r.license_key).slice(0, LIMIT);

mkdirSync(PHOTO_DIR, { recursive: true });
let ledger = existsSync(LEDGER_PATH) ? JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) : {};
function flushLedger() {
  const tmp = LEDGER_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(ledger, null, 0));
  renameSync(tmp, LEDGER_PATH);
}

const now = Date.now();
const isDone = (lk) => {
  const e = ledger[lk];
  if (!e || !e.fetched_at) return false;
  const fresh = (now - Date.parse(e.fetched_at)) / 86400000 < TTL_DAYS;
  return fresh && (e.blob_url || e.status === 'none'); // has a Blob URL, or known no-photo
};
const detailsUrl = (pid) => `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(pid)}&fields=photos&key=${key}`;
const photoUrl = (ref) => `https://maps.googleapis.com/maps/api/place/photo?maxwidth=${MAXWIDTH}&photoreference=${encodeURIComponent(ref)}&key=${key}`;

// --- refinement: prefer business / editorial photos over random user photos ---
const stripTags = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim();
const STOP = new Set(['restaurant', 'grill', 'bar', 'cafe', 'kitchen', 'pizza', 'the', 'and', 'of', 'llc', 'inc', 'co', 'corp', 'bbq', 'food', 'foods', 'company', 'house', 'place', 'eatery', 'diner', 'tavern', 'pub', 'market', 'cocina', 'grille']);
const tokensOf = (s) => stripTags(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t));
const EDITORIAL = /\b(zagat|tripadvisor|yelp|infatuation|eater|michelin|opentable|foursquare)\b/i;
function scorePhoto(photo, rname) {
  const attribs = (photo.html_attributions || []).map(stripTags);
  if (!attribs.length) return 2; // no attribution → usually owner/Google photo
  const rt = new Set(tokensOf(rname));
  for (const a of attribs) {
    if (EDITORIAL.test(a)) return 3;
    const at = tokensOf(a);
    if (at.length && at.filter((t) => rt.has(t)).length >= 1 && at.filter((t) => rt.has(t)).length / at.length >= 0.4) return 3; // business name ≈ restaurant
  }
  return 0; // user photo
}
function chooseBest(photos, rname) {
  const cands = (photos || []).slice(0, 4).map((p, i) => ({ p, i, score: scorePhoto(p, rname) }));
  cands.sort((a, b) => b.score - a.score || a.i - b.i);
  return cands[0] || null;
}

const t = { details: 0, photo: 0, reused: 0, blob: 0, saved: 0, none: 0, skipped: 0, changed: 0, errors: 0, done: 0 };
const est = () => (t.details * DETAILS_COST + t.photo * PHOTO_COST).toFixed(2);

async function processOne(r) {
  const lk = String(r.license_key);
  if (!FORCE && isDone(lk)) { t.skipped++; return; }
  const prev = ledger[lk] || {};

  let dj;
  try { dj = await (await fetch(detailsUrl(r.place_id))).json(); }
  catch { t.errors++; return; }
  if (['OK', 'ZERO_RESULTS', 'NOT_FOUND'].includes(dj.status)) t.details++;
  if (dj.status !== 'OK' || !dj.result?.photos?.length) {
    ledger[lk] = { status: 'none', reason: dj.status === 'OK' ? 'no_photos' : dj.status, fetched_at: new Date(now).toISOString() };
    t.none++; return;
  }

  const best = chooseBest(dj.result.photos, r.name);
  const ref = best.p.photo_reference;
  const attribution = best.p.html_attributions || [];
  const localPath = `${PHOTO_DIR}/${lk}.jpg`;
  // photo_reference tokens rotate, so detect change by the chosen INDEX instead
  // (v1 always used index 0, so a non-zero pick == the refinement changed it).
  const prevIdx = Number.isInteger(prev.chosen_index) ? prev.chosen_index : 0;
  const changed = best.i !== prevIdx;

  // bytes: reuse the local cache when the same index is already on disk; else buy
  let bytes;
  if (!changed && existsSync(localPath)) {
    bytes = readFileSync(localPath);
    t.reused++;
  } else {
    try {
      const res = await fetch(photoUrl(ref));
      const ct = res.headers.get('content-type') || '';
      bytes = Buffer.from(await res.arrayBuffer());
      t.photo++;
      if (!ct.startsWith('image/') || bytes.length < 1000) {
        ledger[lk] = { status: 'none', reason: 'photo_not_image', fetched_at: new Date(now).toISOString() };
        t.none++; return;
      }
      writeFileSync(localPath, bytes);
      t.saved++;
    } catch { t.errors++; return; }
  }

  // upload to Vercel Blob (stable path → deterministic, idempotent URL)
  try {
    const blob = await put(`restaurant-photos/${lk}.jpg`, bytes, {
      access: 'public', token: blobToken, contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true,
    });
    t.blob++;
    if (changed) t.changed++;
    ledger[lk] = { status: 'ok', blob_url: blob.url, attribution, photo_reference: ref, chosen_index: best.i, attribution_score: best.score, fetched_at: new Date(now).toISOString() };
  } catch (e) { t.errors++; if (t.errors <= 3) console.error('blob error:', e.message); }
}

console.log(`Targets: ${targets.length} · TTL ${TTL_DAYS}d · maxwidth ${MAXWIDTH}${FORCE ? ' · FORCE' : ''}`);
let cursor = 0;
async function worker() {
  while (cursor < targets.length) {
    await processOne(targets[cursor++]);
    if (++t.done % 50 === 0) flushLedger();
    if (t.done % 200 === 0) console.log(`  ${t.done}/${targets.length} · blob ${t.blob} (changed ${t.changed}, reused ${t.reused}) · none ${t.none} · skip ${t.skipped} · err ${t.errors} · billable D${t.details}+P${t.photo} ~$${est()}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
flushLedger();

console.log('\n================ DONE ================');
console.log(`processed: ${targets.length}`);
console.log(`uploaded to Blob: ${t.blob} · changed by refinement: ${t.changed} · reused local bytes: ${t.reused} · new photo buys: ${t.saved}`);
console.log(`no photo (monogram): ${t.none} · skipped (cached): ${t.skipped} · errors: ${t.errors}`);
console.log(`BILLABLE — Place Details: ${t.details} · Place Photo: ${t.photo} · total: ${t.details + t.photo}`);
console.log(`ESTIMATED GOOGLE COST this run: $${est()}  (Vercel Blob storage/egress billed separately, ~pennies)`);
