// ---------------------------------------------------------------------------
// Programmatic prose engine.
//
// Goal: no two generated pages read like the same template with swapped values.
// Every sentence must trace to a real field on the record — nothing is invented.
//
// Strategy:
//   1. Compute the SINGLE most distinctive true fact about this record (its
//      "profile") and open with that — a beloved-but-failing place does not get
//      the same intro as a quiet A.
//   2. Rotate phrasing within a profile using a stable per-slug hash. Lead and
//      support use INDEPENDENT seeds, so two records sharing a profile rarely
//      collide on both. Deterministic → reproducible builds (no Math.random).
//   3. Surface information a reader can't get from a maps listing: the specific
//      violations, the inspection trend, the county percentile, the enforcement
//      disposition, the safer-nearby comparison — in plain language.
// ---------------------------------------------------------------------------
import { titleCase, formatDate, formatMonthYear, listJoin } from './format.js';

// FNV-1a → small int. Stable across builds for a given string.
function seedOf(s) {
  let h = 2166136261;
  for (let i = 0; i < String(s).length; i++) {
    h ^= String(s).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const pick = (arr, seed) => arr[seed % arr.length];
const num = (n) => Number(n).toLocaleString('en-US');
const gradeArticle = (g) => (g === 'A' || g === 'F' ? `an ${g}` : `a ${g}`);

function violationParts(r) {
  return [
    r.hp_violations ? `${r.hp_violations} high-priority` : null,
    r.intermediate_violations ? `${r.intermediate_violations} intermediate` : null,
    r.basic_violations ? `${r.basic_violations} basic` : null,
  ].filter(Boolean);
}

// ===========================================================================
// LISTING (restaurant detail) prose
// ===========================================================================
// Tidy generated copy: collapse doubled sentence punctuation (e.g. a name that
// ends in "CO." followed by a period), stray double spaces, and space-before-comma.
function tidy(s) {
  return typeof s === 'string'
    ? s.replace(/\.\.+/g, '.').replace(/ {2,}/g, ' ').replace(/\s+([.,;:])/g, '$1').trim()
    : s;
}

export function listingProse(r, opts = {}) {
  const out = buildListingProse(r, opts);
  out.lead = tidy(out.lead);
  out.support = tidy(out.support);
  if (out.callout) out.callout.text = tidy(out.callout.text);
  attachListingFormat(r, out);
  return out;
}

// FORMAT ROTATION (structural variety): same facts, different page skeleton.
// Narrative-strong profiles stay prose; the rest rotate prose / Q&A / data-table
// by a stable per-slug hash, so adjacent pages don't share a shape.
function attachListingFormat(r, out) {
  const g = String(r.health_grade || '').toUpperCase();
  const known = ['A', 'B', 'C', 'D', 'F'].includes(g);
  const score = Number.isFinite(r.health_score) ? r.health_score : null;
  const pct = Number.isFinite(r.health_percentile) ? r.health_percentile : null;
  const hasRating = Number.isFinite(r.rating) && Number.isFinite(r.reviews_count) && r.reviews_count > 0;
  const county = r.county || null;
  const date = formatDate(r.latest_inspection_date);
  const mY = formatMonthYear(r.latest_inspection_date);
  const viol = violationParts(r);
  const totalViol = (r.hp_violations || 0) + (r.intermediate_violations || 0) + (r.basic_violations || 0);
  const art = known ? gradeArticle(g) : null;
  const key = r.slug || r.url || r.name || 'x';
  const fseed = seedOf(key + '#fmt');
  const qseed = seedOf(key + '#q');

  const proseOnly = ['unrated', 'emergency', 'wedge'].includes(out.profile);
  out.format = proseOnly ? 'prose' : pick(['prose', 'prose', 'qa', 'table'], fseed);

  // Q&A block — a direct answer-engine-friendly verdict
  if (known) {
    // All questions are positively-framed yes/no, so the verdict answer fits.
    const questions = [
      `Is ${r.name} clean?`,
      `Did ${r.name} pass its last health inspection?`,
      `Is ${r.name} a safe place to eat?`,
      `Is ${r.name}'s kitchen up to standard?`,
      `Does ${r.name} keep a clean kitchen?`,
      `Would ${r.name} pass a health inspection today?`,
    ];
    const verdict =
      g === 'A' ? `Yes — ${art} grade, ${score}/100, at its most recent inspection${date ? ` on ${date}` : ''}.`
        : g === 'B' ? `Mostly — ${art} (${score}/100) at its latest inspection${date ? `, ${date}` : ''}.`
          : g === 'C' ? `Not quite — only ${art}, ${score}/100, the last time the state checked${date ? ` (${date})` : ''}.`
            : `No — ${art}, ${score}/100, at its most recent inspection${date ? ` on ${date}` : ''}.`;
    const second = totalViol === 0 ? `Inspectors cited no violations.` : viol.length ? `That visit logged ${listJoin(viol)} violation${totalViol === 1 ? '' : 's'}.` : '';
    out.qa = { q: pick(questions, qseed), a: tidy(`${verdict} ${second}`) };
  } else {
    out.qa = { q: `What's the health grade for ${r.name}?`, a: `It isn't rated yet — there's no gradable inspection on record, so we don't assign one.` };
  }

  // Data-table block — a tight verdict card
  const qf = [{ k: 'Health grade', v: known ? `${g} · ${score}/100` : 'Not rated' }];
  if (pct !== null && county) qf.push({ k: `${county} County rank`, v: pct >= 99 ? 'Among the cleanest' : pct <= 1 ? 'Near the bottom' : `Safer than ${pct}%` });
  if (hasRating) qf.push({ k: 'Diner rating', v: `${r.rating} ★ · ${num(r.reviews_count)} reviews` });
  if (known) qf.push({ k: 'Violations', v: totalViol === 0 ? 'None cited' : listJoin(viol) });
  if (mY) qf.push({ k: 'Last inspected', v: mY });
  out.quickfacts = qf;
  if (out.format === 'table' && qf.length < 3) out.format = 'prose';
}

function buildListingProse(r, opts = {}) {
  const { latestDisposition = null, hasSafer = false } = opts;
  const key = r.slug || r.url || r.name || 'x';
  const lseed = seedOf(key);          // lead rotation
  const sseed = seedOf(key + '#s');   // support rotation (independent)

  const g = String(r.health_grade || '').toUpperCase();
  const known = ['A', 'B', 'C', 'D', 'F'].includes(g);
  const score = Number.isFinite(r.health_score) ? r.health_score : null;
  const pct = Number.isFinite(r.health_percentile) ? r.health_percentile : null;
  const hasRating =
    Number.isFinite(r.rating) && Number.isFinite(r.reviews_count) && r.reviews_count > 0;
  const rating = r.rating;
  const rev = r.reviews_count;
  const trend = r.inspection_trend || null;
  const date = formatDate(r.latest_inspection_date);
  const city = titleCase(r.city);
  const county = r.county || null;
  const cuisine = r.cuisine && r.cuisine !== 'other' ? titleCase(r.cuisine) : null;
  const dietAll = Array.isArray(r.dietary) ? r.dietary.map((x) => String(x).replace(/_/g, '-')) : [];
  const totalViol = (r.hp_violations || 0) + (r.intermediate_violations || 0) + (r.basic_violations || 0);
  const art = known ? gradeArticle(g) : null;

  const violList = violationParts(r);
  const violCount = `${violList.length ? listJoin(violList) : ''} violation${totalViol === 1 ? '' : 's'}`;
  // Percentile phrasing, guarded at the extremes: "safer than 100%/0%" reads
  // wrong for the top/bottom scorer, so those get ranked language instead.
  const pctSafer =
    pct === null || !county
      ? null
      : pct >= 99
        ? `among the cleanest kitchens in ${county} County`
        : pct <= 1
          ? `near the bottom of ${county} County on health score`
          : `safer than ${pct}% of ${county} County restaurants we grade`;
  const pctShort =
    pct === null || !county
      ? null
      : pct >= 99
        ? `top of ${county} County`
        : pct <= 1
          ? `bottom of ${county} County`
          : `safer than ${pct}% of ${county} County`;
  const ratingFrag = hasRating ? `${rating} stars across ${num(rev)} reviews` : null;
  // dietary line, capped so over-tagged records don't read like a keyword dump
  const dietFrag = dietAll.length
    ? dietAll.length <= 4
      ? `Menus here flag options for ${listJoin(dietAll)} diners.`
      : `Menus here flag ${dietAll.slice(0, 4).join(', ')}, and other dietary options.`
    : '';
  const emergency = latestDisposition && /emergency/i.test(latestDisposition);
  const emergencyResolved = emergency && /complied/i.test(latestDisposition) && !/not complied/i.test(latestDisposition);
  const sentence = (s) => (s && /[.?!]$/.test(s.trim()) ? s.trim() : s ? s.trim() + '.' : '');
  const join = (...xs) => xs.map(sentence).filter(Boolean).join(' ');

  // ----- 0. Not rated -----
  if (!known) {
    const leads = [
      `${r.name} doesn't carry a health grade yet — and that's deliberate. We grade restaurants from their most recent Florida DBPR inspection, and there isn't a gradable one on record here right now, so rather than guess, we leave it unrated until the state posts one.`,
      `There's no letter on this page for ${r.name}, by design. Without a recent, scoreable DBPR inspection on file, we won't assign a grade we can't stand behind.`,
      `${r.name} is unrated for now. A grade here is only as good as the inspection behind it, and we don't have a current, gradable one on file — so the slot stays empty rather than guessed.`,
    ];
    const support = join(
      hasRating ? `Diners have left ${num(rev)} reviews averaging ${rating} stars, so it's hardly unknown locally — but a crowd rating isn't a kitchen inspection, and the two often disagree` : '',
      `The moment a gradable inspection is published, this page will show the letter, the score, and the violations behind it`
    );
    return { profile: 'unrated', lead: pick(leads, lseed), support, callout: { kind: 'na', text: `No current health grade${ratingFrag ? ` · ${rating}★ from ${num(rev)} reviews` : ''}` }, promoteSafer: false };
  }

  // ----- 1. Active emergency order -----
  if (emergency && !emergencyResolved) {
    const leads = [
      `The most serious thing on ${r.name}'s record isn't the ${g} grade — it's the enforcement action behind it. Its most recent inspection${date ? ` on ${date}` : ''} ended with "${latestDisposition}", the response Florida reserves for conditions it treats as an immediate risk.`,
      `Start with the disposition, not the letter: ${r.name}'s last inspection${date ? ` (${date})` : ''} closed as "${latestDisposition}". An emergency order is the strongest step a DBPR inspector takes, and it sits at the top of this restaurant's history for a reason.`,
      `${r.name} drew the state's heaviest hand. Its latest inspection${date ? ` on ${date}` : ''} ended in "${latestDisposition}" — not a routine write-up but an emergency action, which is why it leads this page over the ${g} grade itself.`,
    ];
    const support = join(
      violList.length ? `That visit logged ${violCount}` : '',
      pctSafer ? `On health score it currently ranks ${pctSafer}` : '',
      hasSafer ? `Higher-graded kitchens close by are mapped in the safer-options list below` : ''
    );
    return { profile: 'emergency', lead: pick(leads, lseed), support, callout: { kind: 'alert', text: `Last inspection: ${latestDisposition}${date ? ` · ${date}` : ''}` }, promoteSafer: hasSafer };
  }

  // ----- 2. The wedge — loved by diners, failed by the state -----
  if ((g === 'F' || g === 'D') && hasRating && rating >= 4.5) {
    const leads = [
      `${r.name} is one of Central Florida's sharpest contradictions: ${rating} stars from ${num(rev)} diners, and ${art} health grade from the state. People plainly love the food. The inspection report tells a rougher story.`,
      `Few places split the difference like ${r.name}. The dining room gives it ${rating} stars across ${num(rev)} reviews; the inspector gave it ${art} — ${score} out of 100 — at its most recent visit${date ? ` on ${date}` : ''}.`,
      `Great reviews, failing grade. ${r.name} carries a ${rating}-star reputation on ${num(rev)} reviews, but its kitchen last graded out at ${score}/100 — ${art} on our A–F scale.`,
      `The crowd and the inspector disagree about ${r.name}, and it isn't close: ${num(rev)} reviewers settle on ${rating} stars, while its latest health inspection lands at ${art}, ${score}/100.`,
      `${r.name} is a ${rating}-star room with ${art}-grade kitchen — the kind of gap a star rating will never warn you about, which is the whole reason this page exists.`,
    ];
    const sA = join(
      violList.length ? `That ${g} comes from ${violCount} cited ${date ? `on ${date}` : 'at the last inspection'}` : '',
      pctSafer ? `It currently ranks ${pctSafer}${pct !== null && pct >= 2 && pct <= 15 ? ' — close to the bottom of the county' : ''}` : '',
      trend === 'declining' ? `And the direction isn't reassuring: its recent inspections have been sliding, not recovering` : trend === 'improving' ? `One bright spot — its recent inspections have been trending cleaner` : '',
      hasSafer ? `If you want the flavor with fewer question marks, the safer-options list below maps higher-graded kitchens within a short drive` : ''
    );
    const sB = join(
      pctSafer ? `By health score it sits ${pctSafer} — among the riskier kitchens in the county` : '',
      violList.length ? `The grade reflects ${violCount} at its last inspection${date ? ` on ${date}` : ''}` : '',
      trend === 'declining' ? `Worse, the trend is downward` : trend === 'improving' ? `The trend, at least, is improving` : '',
      hasSafer ? `Safer, higher-graded picks nearby are listed below` : ''
    );
    return { profile: 'wedge', lead: pick(leads, lseed), support: pick([sA, sB], sseed), callout: { kind: 'wedge', text: `Loved (${rating}★) but failing (${g}, ${score}/100)${pctShort ? ` · ${pctShort}` : ''}` }, promoteSafer: hasSafer };
  }

  // ----- 3. Hidden gem -----
  if (r.hidden_gem) {
    const leads = [
      `${r.name} is the kind of place this site exists to surface: ${art} kitchen at ${score}/100, ${rating} stars, and only ${num(rev)} reviews. Well-known to the regulars, invisible to everyone else.`,
      `Quietly excellent. ${r.name} pairs ${art} health grade (${score}/100) with a ${rating}-star reputation built on just ${num(rev)} reviews — a hidden gem by our definition: strong ratings, low volume, clean inspection.`,
      `${r.name} hasn't been discovered yet, and that's the appeal: ${rating} stars on only ${num(rev)} reviews, backed by ${art}, ${score}/100 health grade.`,
    ];
    const sA = join(
      cuisine ? `It's a ${cuisine} spot in ${city}${county ? `, ${county} County` : ''}` : `It's in ${city}${county ? `, ${county} County` : ''}`,
      pctSafer ? `On health score it sits ${pctSafer}${trend === 'improving' ? ', and its inspections have been trending up' : ''}` : '',
      dietFrag
    );
    const sB = join(
      pctSafer ? `Cleaner than most of its neighbors — ${pctSafer}` : '',
      cuisine ? `Find it in ${city}, where it serves ${cuisine.toLowerCase()}` : `Find it in ${city}`,
      dietFrag
    );
    return { profile: 'gem', lead: pick(leads, lseed), support: pick([sA, sB], sseed), callout: { kind: 'gem', text: `Hidden gem · ${rating}★ on only ${num(rev)} reviews · ${g} kitchen (${score}/100)` }, promoteSafer: false };
  }

  // ----- 4. Failing/poor without the high rating -----
  if (g === 'F' || g === 'D') {
    const leads = [
      `${r.name} is among the lower-graded kitchens we track. Its most recent inspection${date ? ` on ${date}` : ''} put it at ${score}/100 — ${art} on our A–F scale.`,
      `The grade here is the headline: ${r.name} sits at ${art} (${score}/100) after its latest health inspection${date ? ` on ${date}` : ''}.`,
      `${r.name} didn't pass cleanly. Its last DBPR inspection${date ? ` on ${date}` : ''} scored ${score}/100, ${art} on our scale.`,
      `There's no soft way to read ${art} grade. ${r.name} came out of its most recent inspection${date ? ` (${date})` : ''} at ${score}/100.`,
    ];
    const sA = join(
      violList.length ? `Inspectors cited ${violCount}` : 'No violations were itemized at that visit',
      pctSafer ? `That leaves it ${pctSafer}` : '',
      trend === 'declining' ? `Its trend is downward, not up` : trend === 'improving' ? `On the upside, the trend has been improving` : '',
      hasSafer ? `Safer, higher-graded options nearby are listed below` : ''
    );
    const sB = join(
      pctSafer ? `By score it ranks ${pctSafer}` : '',
      violList.length ? `The report logged ${violCount}` : 'Nothing was itemized on the report',
      trend === 'improving' ? `Its inspections have at least been improving lately` : trend === 'declining' ? `And the recent trend is down` : '',
      hasSafer ? `Higher-graded kitchens nearby are mapped below` : ''
    );
    return { profile: 'failing', lead: pick(leads, lseed), support: pick([sA, sB], sseed), callout: { kind: 'alert', text: `${g} grade · ${score}/100${pctSafer ? ` · ${pctSafer}` : ''}` }, promoteSafer: hasSafer };
  }

  // ----- 5. Improving trend on a non-A grade with violations -----
  if (trend === 'improving' && (g === 'B' || g === 'C') && totalViol > 0) {
    const leads = [
      `${r.name} is trending the right way. After earlier inspections that drew violations, its recent DBPR history has been improving — and it currently holds ${art} at ${score}/100.`,
      `Direction matters as much as the letter. ${r.name} sits at ${art} (${score}/100) today, but its inspections have been getting cleaner, not messier — an improving trend a single grade can't show.`,
      `${r.name} is on the mend. The grade is ${art} (${score}/100), yet the trajectory across its recent inspections points up.`,
    ];
    const sA = join(
      violList.length ? `Its latest visit${date ? ` (${date})` : ''} logged ${violCount}` : '',
      ratingFrag ? `Diners rate it ${rating} across ${num(rev)} reviews` : '',
      pctSafer ? `By health score it's ${pctSafer}` : '',
      dietFrag
    );
    const sB = join(
      pctSafer ? `It currently ranks ${pctSafer}` : '',
      violList.length ? `The most recent report${date ? ` (${date})` : ''} still cited ${violCount}, so there's room to climb` : '',
      ratingFrag ? `Diner rating: ${rating} from ${num(rev)} reviews` : '',
      dietFrag
    );
    return { profile: 'improving', lead: pick(leads, lseed), support: pick([sA, sB], sseed), callout: { kind: 'trend', text: `Trend: improving · ${g} (${score}/100)${pctSafer ? ` · ${pctSafer}` : ''}` }, promoteSafer: false };
  }

  // ----- 6. Declining on a still-passing grade -----
  if (trend === 'declining' && (g === 'B' || g === 'C')) {
    const leads = [
      `${r.name} is slipping. It still carries ${art} (${score}/100), but the trend across its recent inspections points down — worth a look at the history below before you go.`,
      `Watch the trajectory here. ${r.name} grades ${art} at ${score}/100 today, yet its recent DBPR record has been moving the wrong way.`,
      `The letter looks fine; the direction doesn't. ${r.name} holds ${art} (${score}/100), but its inspections have been getting worse, not better.`,
    ];
    const support = join(
      violList.length ? `Its most recent inspection${date ? ` on ${date}` : ''} cited ${violCount}` : '',
      pctSafer ? `It currently ranks ${pctSafer}` : '',
      ratingFrag ? `Diner rating: ${rating} from ${num(rev)} reviews` : ''
    );
    return { profile: 'declining', lead: pick(leads, lseed), support, callout: { kind: 'trend', text: `Trend: declining · ${g} (${score}/100)` }, promoteSafer: false };
  }

  // ----- 7. Top-tier A with strong rating — harmony -----
  if (g === 'A' && score !== null && score >= 95 && hasRating && rating >= 4.6) {
    const leads = [
      `${r.name} is the easy recommendation: ${art} health grade at ${score}/100 and ${rating} stars from ${num(rev)} diners. A clean kitchen and a room that loves it don't always line up — here they do.`,
      `Both halves check out at ${r.name}. The state scores it ${score}/100 (${art}); ${num(rev)} diners score it ${rating}. That alignment is rarer than it should be.`,
      `${r.name} earns its reputation twice over — ${rating} stars from ${num(rev)} diners and ${art}, ${score}/100 from the inspector.`,
      `No asterisks on ${r.name}: ${art} kitchen at ${score}/100, ${rating} stars across ${num(rev)} reviews. The food and the inspection agree.`,
      `${r.name} is a rare double — ${art} kitchen at ${score}/100 and ${rating} stars from ${num(rev)} diners.`,
      `You can trust both numbers at ${r.name}: ${score}/100 from the state, ${rating}★ from ${num(rev)} diners.`,
    ];
    const sA = join(
      totalViol === 0 ? `Its most recent inspection${date ? ` on ${date}` : ''} cited no violations at all` : `Its latest inspection${date ? ` on ${date}` : ''} cited only ${violCount}`,
      pct !== null && pct >= 70 && county ? `That puts it ${pctSafer}${pct >= 99 ? '' : ' — near the top of the county'}` : pctSafer ? `On health score it's ${pctSafer}` : '',
      dietFrag
    );
    const sB = join(
      pct !== null && county ? `It ranks ${pctSafer}` : '',
      totalViol === 0 ? `The last inspection${date ? ` (${date})` : ''} came back spotless` : `The last inspection${date ? ` (${date})` : ''} noted just ${violCount}`,
      dietFrag
    );
    return { profile: 'harmony-a', lead: pick(leads, lseed), support: pick([sA, sB], sseed), callout: { kind: 'clean', text: `${g} · ${score}/100${totalViol === 0 ? ' · no violations cited' : ''}${pctShort ? ` · ${pctShort}` : ''}` }, promoteSafer: false };
  }

  // ----- 8. High-percentile A/B — ranking story -----
  if ((g === 'A' || g === 'B') && pct !== null && pct >= 80 && county) {
    const leads = [
      `Among ${county} County restaurants, ${r.name} ranks near the top for cleanliness — ${pctSafer}, with ${art} grade at ${score}/100.`,
      `${r.name} grades better than most of its neighbors: ${pctSafer}, holding ${art} at ${score}/100.`,
      `Few ${county} County kitchens score higher than ${r.name} — ${art} at ${score}/100, ${pctSafer}.`,
      `${r.name} is one of the cleaner kitchens in ${county} County: ${pctSafer}, at ${art} ${score}/100.`,
      `On health score, ${r.name} outranks most of ${county} County — ${pctSafer}, holding ${art} (${score}/100).`,
      `${r.name} lands in the top tier for ${county} County cleanliness: ${art}, ${score}/100, ${pctSafer}.`,
    ];
    const support = join(
      totalViol === 0 ? `Its most recent inspection${date ? ` on ${date}` : ''} came back clean` : `Its latest inspection${date ? ` on ${date}` : ''} cited ${violCount}`,
      ratingFrag ? `Diners give it ${rating} across ${num(rev)} reviews` : '',
      cuisine ? `It's a ${cuisine} spot in ${city}` : '',
      dietFrag
    );
    return { profile: 'top-percentile', lead: pick(leads, lseed), support, callout: { kind: 'clean', text: `${g} · ${score}/100 · ${pctSafer}` }, promoteSafer: false };
  }

  // ----- 9. Default A — calm, specific clean-record intro (the most common case) -----
  if (g === 'A') {
    const leads = [
      `${r.name} keeps a tidy record. Its most recent health inspection${date ? ` on ${date}` : ''} came back ${art} at ${score} out of 100${totalViol === 0 ? ', with nothing cited' : ''}.`,
      `${r.name}, ${art} kitchen in ${city}, cleared its most recent inspection${date ? ` on ${date}` : ''} at ${score}/100.`,
      `No drama at ${r.name}: ${art} grade, ${score}/100, ${totalViol === 0 ? 'a clean inspection' : `${violCount} cited`} at its last visit${date ? ` on ${date}` : ''}.`,
      `${r.name} passes cleanly. The state put it at ${art}, ${score}/100, at its latest health inspection${date ? ` on ${date}` : ''}.`,
      `Solid and unflashy: ${r.name} holds ${art} health grade, ${score}/100, out of its most recent ${county ? `${county} County ` : ''}inspection${date ? ` on ${date}` : ''}.`,
      `${r.name} does the basics right — ${art} grade, ${score}/100, at its most recent inspection${date ? ` on ${date}` : ''}.`,
      `Nothing to flag at ${r.name}: it came out of its latest inspection${date ? ` (${date})` : ''} ${art} at ${score}/100.`,
      `${r.name} sits comfortably in A territory, ${score}/100 at its last health check${date ? ` on ${date}` : ''}.`,
      `${r.name} is a quiet keeper — ${art} kitchen, ${score}/100, no fuss${date ? `, last checked ${date}` : ''}.`,
    ];
    const sA = join(
      pctSafer ? `On health score it's ${pctSafer}` : '',
      ratingFrag ? `Diners rate it ${rating} from ${num(rev)} reviews` : '',
      cuisine ? `Cuisine: ${cuisine}` : '',
      dietFrag
    );
    const ratingAndPct =
      ratingFrag && pctSafer
        ? `It pulls ${rating} stars across ${num(rev)} reviews and ranks ${pctSafer}`
        : ratingFrag
          ? `It pulls ${rating} stars across ${num(rev)} reviews`
          : pctSafer
            ? `It ranks ${pctSafer}`
            : '';
    const sB = join(ratingAndPct, cuisine ? `Look for ${cuisine.toLowerCase()} in ${city}` : '', dietFrag);
    return { profile: 'quiet-a', lead: pick(leads, lseed), support: pick([sA, sB], sseed), callout: totalViol === 0 ? { kind: 'clean', text: `${g} · ${score}/100 · no violations cited` } : null, promoteSafer: false };
  }

  // ----- 10. Default B/C — balanced middle -----
  const leads = [
    `${r.name} lands in the middle of the pack: ${art} health grade at ${score}/100 from its most recent inspection${date ? ` on ${date}` : ''}.`,
    `${r.name} grades ${art} — ${score}/100 — a solid-but-not-spotless result at its latest ${county ? `${county} County ` : ''}inspection${date ? ` on ${date}` : ''}.`,
    `Middle of the road for ${r.name}: ${art} (${score}/100) at its last health inspection${date ? ` on ${date}` : ''}.`,
    `${r.name} comes out ${art}, ${score}/100 — passing, with room to tighten up, per its most recent inspection${date ? ` on ${date}` : ''}.`,
    `${r.name} is a fair-to-middling result — ${art}, ${score}/100, at its latest inspection${date ? ` on ${date}` : ''}.`,
    `Not spotless, not failing: ${r.name} grades ${art} at ${score}/100${date ? ` as of ${date}` : ''}.`,
  ];
  const mA = join(
    violList.length ? `Inspectors cited ${violCount}` : 'No violations were itemized at that visit',
    pctSafer ? `That puts it ${pctSafer}` : '',
    trend === 'improving' ? `The trend has been improving` : trend === 'declining' ? `The trend has been declining — check the history below` : '',
    ratingFrag ? `Diner rating: ${rating} from ${num(rev)} reviews` : '',
    dietFrag
  );
  const mB = join(
    pctSafer ? `By health score it ranks ${pctSafer}` : '',
    violList.length ? `Its last report logged ${violCount}` : 'Nothing was itemized on its last report',
    ratingFrag ? `Diners give it ${rating} across ${num(rev)} reviews` : '',
    dietFrag
  );
  return { profile: 'middle', lead: pick(leads, lseed), support: pick([mA, mB], sseed), callout: { kind: 'neutral', text: `${g} · ${score}/100${pctSafer ? ` · ${pctSafer}` : ''}` }, promoteSafer: false };
}

// ===========================================================================
// HUB (county / city) intro prose
// ===========================================================================
export function hubIntro(area) {
  const { type, displayName, slug, items } = area;
  const seed = seedOf(slug || displayName || 'h');
  const geo = type === 'county' ? `${displayName} County` : displayName;
  const n = items.length;

  const by = (g) => items.filter((r) => String(r.health_grade).toUpperCase() === g).length;
  const aCount = by('A');
  const fCount = by('F');
  const dCount = by('D');
  const riskCount = dCount + fCount;
  const pctA = n ? Math.round((aCount / n) * 100) : 0;
  const riskPct = n ? Math.round((riskCount / n) * 100) : 0;

  const rated = items.filter((r) => Number.isFinite(r.rating));
  const avgRating = rated.length ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1) : null;

  const cuisineCount = {};
  for (const r of items) if (r.cuisine && r.cuisine !== 'other') cuisineCount[r.cuisine] = (cuisineCount[r.cuisine] || 0) + 1;
  const topCuisineEntry = Object.entries(cuisineCount).sort((a, b) => b[1] - a[1])[0];
  const dominantCuisine =
    topCuisineEntry && topCuisineEntry[1] >= Math.max(8, n * 0.12)
      ? { name: titleCase(topCuisineEntry[0]), count: topCuisineEntry[1] }
      : null;

  const wedge = items
    .filter((r) => ['D', 'F'].includes(String(r.health_grade).toUpperCase()) && Number.isFinite(r.rating) && r.rating >= 4.5 && Number.isFinite(r.reviews_count) && r.reviews_count >= 300)
    .sort((a, b) => b.reviews_count - a.reviews_count)[0] || null;

  const safest = [...items]
    .filter((r) => Number.isFinite(r.health_score))
    .sort((a, b) => b.health_score - a.health_score || (b.reviews_count || 0) - (a.reviews_count || 0))[0] || null;

  const angles = [];
  if (pctA >= 65) angles.push('clean');
  if (riskPct >= 12 || fCount >= 8) angles.push('risk');
  if (wedge) angles.push('wedge');
  if (dominantCuisine) angles.push('cuisine');
  if (n >= 250) angles.push('scale');
  angles.push('balanced');
  const angle = pick(angles, seed);

  let lead;
  if (angle === 'clean') {
    lead =
      `${geo} grades cleaner than most of Central Florida: ${pctA}% of the ${num(n)} restaurants we track here hold an A. ` +
      (safest ? `${safest.name} leads the list at ${safest.health_score}/100. ` : '') +
      `Below, every kitchen is sorted best grade first, so the safest bets rise to the top.`;
  } else if (angle === 'risk') {
    lead =
      `Not every kitchen in ${geo} passes cleanly. Of the ${num(n)} we grade, ${aCount} hold an A — but ${riskCount} sit at D or F. ` +
      (wedge ? `Some are popular anyway: ${wedge.name} pulls ${wedge.rating} stars despite ${gradeArticle(String(wedge.health_grade).toUpperCase())} grade. ` : '') +
      `The grades below cut through the reviews.`;
  } else if (angle === 'wedge') {
    const wg = String(wedge.health_grade).toUpperCase();
    lead =
      `Diner ratings and health grades don't always agree in ${geo} — and ${wedge.name} is the proof, ${wedge.rating} stars from ${num(wedge.reviews_count)} reviews on top of ${gradeArticle(wg)} inspection grade. ` +
      `This page grades all ${num(n)} restaurants here on the kitchen, not the crowd; ${pctA}% earn an A.`;
  } else if (angle === 'cuisine') {
    lead =
      `${geo} leans ${dominantCuisine.name.toLowerCase()} — ${dominantCuisine.count} of the ${num(n)} restaurants we track — and we grade each on its latest Florida health inspection, not its menu. ` +
      `${pctA}% currently hold an A` +
      (avgRating ? `, on an average diner rating of ${avgRating} stars.` : '.');
  } else if (angle === 'scale') {
    lead =
      `${geo} is one of the larger maps on this site: ${num(n)} restaurants, every one carrying a health grade from its most recent DBPR inspection. ` +
      `${pctA}% are A-rated; ${riskCount} sit at D or F. ` +
      `Sort, compare, and see where a place actually lands before you book.`;
  } else {
    lead =
      `Every one of the ${num(n)} restaurants in ${geo} on this page carries an A–F health grade built from its latest Florida DBPR inspection. ` +
      `${aCount} hold an A` +
      (avgRating ? `, and the typical diner rating runs ${avgRating} stars` : '') +
      `. The list runs best grade first.`;
  }

  const calloutBits = [`${num(n)} graded`, `${pctA}% A`];
  if (riskCount > 0) calloutBits.push(`${riskCount} at D/F`);
  if (avgRating) calloutBits.push(`${avgRating}★ avg`);

  // --- format rotation: prose / stat-lead / Q&A, by stable hash ---
  const fseed = seedOf((slug || displayName || 'h') + '#fmt');
  const stat = calloutBits.join(' · ');
  const statLeads = [
    safest ? `${safest.name} leads at ${safest.health_score}/100; the rest follow, best grade first.` : null,
    `Sorted best grade first, so the safest tables rise to the top.`,
    `Every kitchen below carries a grade from its most recent Florida inspection.`,
    `Tap any name for its full violation record and inspection history.`,
    riskCount ? `${riskCount} sit at D or F — the list makes them easy to spot.` : null,
    avgRating ? `Diner ratings here average ${avgRating} stars; the grades tell the other half of the story.` : null,
    `Grades come from each kitchen's latest inspection, not its reviews.`,
    pctA >= 60 ? `Most grade well — ${pctA}% hold an A — but the list flags every exception.` : `Only ${pctA}% hold an A, so it pays to check before you go.`,
    wedge ? `Some highly-rated names still grade poorly here; the list sorts that out.` : null,
  ].filter(Boolean);
  const statLead = pick(statLeads, seedOf((slug || 'h') + '#sl'));
  const question = `How clean are ${geo}'s restaurants?`;
  const answer = `${pctA}% of the ${num(n)} we grade hold an A${safest ? `, led by ${safest.name} at ${safest.health_score}/100` : ''}.${riskCount ? ` ${riskCount} sit at D or F.` : ''}`;
  const format = n < 5 ? 'prose' : pick(['prose', 'prose', 'stat', 'qa'], fseed);

  return { format, lead: tidy(lead), stat, statLead, question: tidy(question), answer: tidy(answer), callout: stat, angle };
}

// ===========================================================================
// Shared list helpers (filter + special pages)
// ===========================================================================
const grOf = (r) => String(r.health_grade).toUpperCase();
function listStats(items) {
  const n = items.length;
  const aCount = items.filter((r) => grOf(r) === 'A').length;
  const pctA = n ? Math.round((aCount / n) * 100) : 0;
  const rated = items.filter((r) => Number.isFinite(r.rating));
  const avgRating = rated.length ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1) : null;
  return { n, aCount, pctA, avgRating };
}
const bestByScore = (items) =>
  [...items].filter((r) => Number.isFinite(r.health_score)).sort((a, b) => b.health_score - a.health_score || (b.reviews_count || 0) - (a.reviews_count || 0))[0] || null;
const worstByScore = (items) =>
  [...items].filter((r) => Number.isFinite(r.health_score)).sort((a, b) => a.health_score - b.health_score || (b.reviews_count || 0) - (a.reviews_count || 0))[0] || null;
const topRated = (items) =>
  [...items].filter((r) => Number.isFinite(r.rating)).sort((a, b) => b.rating - a.rating || (b.reviews_count || 0) - (a.reviews_count || 0))[0] || null;
const wedgeIn = (items) =>
  [...items].filter((r) => ['D', 'F'].includes(grOf(r)) && Number.isFinite(r.rating) && r.rating >= 4.5 && (r.reviews_count || 0) >= 200).sort((a, b) => b.reviews_count - a.reviews_count)[0] || null;
function violOf(r) {
  const parts = violationParts(r);
  return parts.length ? listJoin(parts) : null;
}
const scoreWord = (s) => (s === 100 ? 'a perfect 100/100' : `${s}/100`);

// ===========================================================================
// FILTER pages (dietary×geo, cuisine×geo)
// ===========================================================================
export function filterIntro(page) {
  const { kind, flag, label, geoType, geoName, items, url } = page;
  const seed = seedOf(url || label);
  const geo = geoType === 'county' ? `${geoName} County` : geoName;
  const { n, aCount, pctA, avgRating } = listStats(items);
  const best = bestByScore(items);
  const wedge = wedgeIn(items);
  const labelLow = label.toLowerCase();
  const plural = n === 1 ? 'restaurant' : 'restaurants';
  // the list noun, true to the filter kind
  const noun =
    kind === 'cuisine'
      ? `${labelLow} ${plural}`
      : `${plural} with ${flag === 'healthy' ? 'healthy' : labelLow} options`;

  const angles = [];
  if (pctA >= 60 && best) angles.push('clean');
  if (wedge) angles.push('wedge');
  if (best && Number.isFinite(best.health_score)) angles.push('standout');
  angles.push('scope');
  const angle = pick(angles, seed);

  let lead;
  if (angle === 'clean') {
    lead = `Most of the ${noun} in ${geo} grade well: ${aCount} of ${n} hold an A, led by ${best.name} at ${scoreWord(best.health_score)}. Every listing below carries its latest Florida health grade.`;
  } else if (angle === 'wedge') {
    const wg = gradeArticle(grOf(wedge));
    lead = `A high rating isn't a clean kitchen — ${wedge.name} proves it here, ${wedge.rating} stars on ${wg} grade. That's why each of these ${n} ${noun} in ${geo} shows its health inspection result, not just its stars.`;
  } else if (angle === 'standout') {
    lead = `The cleanest of ${geo}'s ${noun} is ${best.name}, ${scoreWord(best.health_score)} at its last inspection. Here are all ${n}, each graded A–F so you can compare the kitchen, not just the menu.`;
  } else {
    lead = `${n} ${noun} in ${geo}, every one graded from its most recent Florida DBPR inspection. ${aCount} currently hold an A${avgRating ? `, on an average ${avgRating}-star diner rating` : ''}.`;
  }

  const fseed = seedOf((url || label) + '#fmt');
  const stat = [`${num(n)} graded`, `${pctA}% A`, avgRating ? `${avgRating}★ avg` : null, best && Number.isFinite(best.health_score) ? `best ${best.health_score}/100` : null].filter(Boolean).join(' · ');
  const statLead = `Each of these ${noun} in ${geo} carries its latest Florida health grade — sorted best first.`;
  const question = `Which ${labelLow} ${kind === 'cuisine' ? 'restaurants' : 'spots'} in ${geo} grade cleanest?`;
  const answer = `${aCount} of these ${n} hold an A${best ? `; ${best.name} tops them at ${scoreWord(best.health_score)}` : ''}.`;
  const format = n < 4 ? 'prose' : pick(['prose', 'prose', 'stat', 'qa'], fseed);
  return { format, lead: tidy(lead), stat, statLead: tidy(statLead), question: tidy(question), answer: tidy(answer), angle };
}

// ===========================================================================
// SPECIAL pages (top-rated-safe, worst-scores, hidden-gems)
// Worst + gems lean into pointed, specific, shareable "weird but true" framing.
// ===========================================================================
export function specialIntro(page) {
  const { specialType, geoType, geoName, items, url } = page;
  const seed = seedOf(url || geoName || specialType);
  const geo = geoType === 'county' ? `${geoName} County` : geoName;
  const n = items.length;
  const plural = n === 1 ? 'restaurant' : 'restaurants';
  const top = topRated(items);
  const best = bestByScore(items);
  const worst = worstByScore(items);

  let leads, qa;
  if (specialType === 'top_rated_safe') {
    leads = [
      `Clean kitchen, happy room — and these ${n} ${geo} ${plural} pull off both at once. Every one clears an A health grade on top of strong diner ratings.${top ? ` ${top.name} tops the room at ${top.rating} stars.` : ''}`,
      `Both halves check out across all ${n} of these ${geo} ${plural}: an A on the inspection and high marks from diners.${best ? ` ${best.name} grades ${scoreWord(best.health_score)}.` : ''}`,
      `These are the ${geo} ${plural} you can recommend without a caveat — ${n} spots that earn an A health grade and a strong rating in the same breath.${top ? ` Start with ${top.name} (${top.rating}★).` : ''}`,
    ];
    qa = { q: `What are the cleanest top-rated restaurants in ${geo}?`, a: `All ${n} of these clear an A health grade and strong diner ratings${top ? `; ${top.name} leads at ${top.rating}★` : ''}.` };
  } else if (specialType === 'worst_health') {
    const wedge = wedgeIn(items);
    const wv = worst ? violOf(worst) : null;
    leads = [
      worst
        ? `${worst.name} sits at the bottom of the barrel in ${geo}: ${worst.health_score}/100 at its most recent inspection${wv ? `, with ${wv} violations on the report` : ''}. It leads this list of ${n} kitchens that graded D or F last time the state walked in.`
        : `These ${n} ${geo} ${plural} graded D or F at their most recent Florida inspection.`,
      wedge
        ? `Here's what the star ratings won't tell you: ${wedge.name} keeps ${wedge.rating} stars across ${num(wedge.reviews_count)} reviews on ${gradeArticle(grOf(wedge))}-graded kitchen. It's one of ${n} ${geo} ${plural} that failed their last inspection — ranked worst score first.`
        : null,
      `No sugar-coating it: these ${n} ${geo} ${plural} scored a D or F at their most recent Florida health inspection${worst ? `, ${worst.name} lowest of all at ${worst.health_score}/100` : ''}. The state records the violations; we just rank them, worst first.`,
    ].filter(Boolean);
    qa = { q: `Which ${geo} restaurants have the worst health grades?`, a: `These ${n} graded D or F at their most recent inspection${worst ? `, ${worst.name} lowest at ${worst.health_score}/100` : ''}.` };
  } else {
    leads = [
      `The algorithm hasn't caught up to these ${n} ${geo} ${plural} yet: 4.5 stars or better on fewer than 200 reviews, each with a clean health grade to match.${top ? ` ${top.name} leads at ${top.rating} stars on just ${num(top.reviews_count)} reviews.` : ''}`,
      `Locals know; the search results don't. These ${n} ${geo} ${plural} pair high ratings with low review counts and solid inspections — under-the-radar by the numbers.${best ? ` ${best.name} grades ${scoreWord(best.health_score)}.` : ''}`,
      `Small crowds, big ratings, clean kitchens. These ${n} ${geo} ${plural} each clear 4.5 stars on under 200 reviews — the discoveries worth making before everyone else does.`,
    ];
    qa = { q: `What are the best hidden-gem restaurants in ${geo}?`, a: `${n} spots with 4.5★ or better on under 200 reviews and clean grades${top ? `; ${top.name} leads at ${top.rating}★` : ''}.` };
  }

  const format = n < 4 ? 'prose' : pick(['prose', 'prose', 'qa'], seedOf((url || '') + '#fmt'));
  return { format, lead: tidy(pick(leads, seed)), question: tidy(qa.q), answer: tidy(qa.a) };
}

// ===========================================================================
// SITE-WIDE STATS — live facts for the homepage lede + trust pages + 404.
// ===========================================================================
export function siteStats(items) {
  const n = items.length;
  const by = (g) => items.filter((r) => grOf(r) === g).length;
  const counties = new Set(items.map((r) => r.county).filter(Boolean)).size;
  const perfect = items.filter((r) => r.health_score === 100).length;
  const rated = items.filter((r) => Number.isFinite(r.rating));
  return {
    n, counties,
    aCount: by('A'), pctA: n ? Math.round((by('A') / n) * 100) : 0,
    fCount: by('F'), dCount: by('D'), perfect,
    avgRating: rated.length ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1) : null,
  };
}

// Homepage lede — data-driven (engine-sourced live counts), one strong paragraph.
export function homeIntro(items) {
  const s = siteStats(items);
  return `Compare Central Florida restaurants by the one thing Florida won't tell you: how clean they are. We turn the state's public DBPR inspection records into clear A–F health grades for ${num(s.n)} restaurants across ${s.counties} counties — ${num(s.aCount)} currently grade A, ${num(s.perfect)} with a perfect 100 — alongside dietary options and diner ratings. Browse by county, city, or one of the region's named dining districts.`;
}

// ===========================================================================
// HOMEPAGE site-wide hook — the single most shareable true fact about the set.
// The "wedge" phenomenon, as a category (no single business singled out here).
// ===========================================================================
export function siteHook(items) {
  const wedges = items.filter((r) => ['D', 'F'].includes(grOf(r)) && Number.isFinite(r.rating) && r.rating >= 4.5 && (r.reviews_count || 0) >= 100);
  if (wedges.length < 3) return null;
  return {
    count: wedges.length,
    text: `Weird but true: ${num(wedges.length)} Central Florida restaurants keep a 4.5-star rating or better while carrying a D or F health grade. Stars measure the meal; our grades measure the kitchen — and the two don't always agree.`,
  };
}

// ===========================================================================
// REVIEW SYNTHESIS — original, data-derived analysis of a restaurant's own
// review corpus, rendered ABOVE the verbatim quotes.
//
// Why it exists: the verbatim reviews are a median 64% of a listing page's
// words, and that text is duplicated across Maps/Yelp/TripAdvisor/DoorDash.
// This section adds page-unique content computed from THIS restaurant's
// reviews, and cross-references it against the DBPR inspection record — a
// comparison that exists nowhere else on the web.
//
// Rules it follows:
//   * Never quotes review text. It reports measured properties of the corpus
//     (counts, distributions, drift, theme frequency, theme-level ratings).
//   * Every number traces to the data; nothing is asserted that wasn't measured.
//   * Lead angle is chosen by a priority tree on the data, then phrasing rotates
//     on independent per-slug seeds — same conventions as listingProse above.
//   * Returns null below SYN_MIN_REVIEWS rather than emitting a stub.
// ===========================================================================

const SYN_MIN_REVIEWS = 4;

const THEME_PATTERNS = {
  service: /\b(service|staff|server|servers|waiter|waitress|employee|employees|cashier|manager|friendly|rude|attentive|polite|greeted)\b/i,
  wait: /\b(wait|waited|waiting|slow|slowly|quick|quickly|fast|minutes|line|prompt|forever|took)\b/i,
  portion: /\b(portion|portions|size|sizes|huge|generous|plenty|filling|tiny|skimpy|large|small)\b/i,
  freshness: /\b(fresh|freshly|hot|cold|stale|warm|soggy|crispy|crisp|dry|frozen|undercooked|overcooked|raw|burnt)\b/i,
  value: /\b(price|prices|pricey|expensive|cheap|worth|value|affordable|overpriced|deal|cost|costly)\b/i,
  cleanliness: /\b(clean|cleanliness|dirty|filthy|sanitary|hygiene|gross|spotless|bathroom|restroom|sticky|roach|roaches|fly|flies)\b/i,
};

// Several ways to name each theme, so repeated angles don't repeat wording.
const THEME_NOUNS = {
  service: ['service', 'the staff', 'how guests are treated', 'front-of-house'],
  wait: ['wait times', 'speed of service', 'how long an order takes', 'pacing'],
  portion: ['portion size', 'how much food arrives', 'plate size', 'serving size'],
  freshness: ['freshness and temperature', 'how food arrives', 'freshness', 'whether food comes out hot'],
  value: ['price', 'value for money', 'what it costs', 'whether it is worth the money'],
  cleanliness: ['cleanliness', 'the state of the room', 'how clean the place looks', 'tidiness'],
};

/** Measured properties of one restaurant's review corpus. */
export function reviewSignals(entry) {
  if (!entry || !Array.isArray(entry.reviews)) return null;
  const rs = entry.reviews.filter((r) => r && typeof r.text === 'string' && r.text.trim());
  const n = rs.length;
  if (n < SYN_MIN_REVIEWS) return null;

  const rated = rs.filter((r) => Number.isInteger(r.stars) && r.stars >= 1 && r.stars <= 5);
  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of rated) dist[r.stars]++;
  const avg = rated.length ? rated.reduce((s, r) => s + r.stars, 0) / rated.length : null;
  const pos = rated.filter((r) => r.stars >= 4).length;
  const neg = rated.filter((r) => r.stars <= 2).length;
  const mid = rated.length - pos - neg;

  // Stored newest-first: compare the newest third against the oldest third.
  const k = Math.max(2, Math.floor(rated.length / 3));
  const recent = rated.slice(0, k);
  const older = rated.slice(-k);
  const recentAvg = recent.length ? recent.reduce((s, r) => s + r.stars, 0) / recent.length : null;
  const olderAvg = older.length ? older.reduce((s, r) => s + r.stars, 0) / older.length : null;
  const drift = recentAvg != null && olderAvg != null ? recentAvg - olderAvg : 0;

  const themes = [];
  for (const [name, re] of Object.entries(THEME_PATTERNS)) {
    const hits = rs.filter((r) => re.test(r.text));
    if (!hits.length) continue;
    const hr = hits.filter((r) => Number.isInteger(r.stars));
    themes.push({
      name,
      count: hits.length,
      share: hits.length / n,
      avg: hr.length ? hr.reduce((s, r) => s + r.stars, 0) / hr.length : null,
    });
  }
  themes.sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));

  const polarized = rated.length >= 6 && (dist[5] + dist[1]) / rated.length >= 0.7 && dist[1] >= 2;

  // Corpus time span, and which measured themes are notably ABSENT (a real
  // signal: nobody here talks about price, say).
  const dates = rs.map((r) => r.date).filter(Boolean).sort();
  const span = dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
  const present = new Set(themes.map((t) => t.name));
  const absent = Object.keys(THEME_PATTERNS).filter((k) => !present.has(k));
  const modal = Object.entries(dist).sort((a, b) => b[1] - a[1])[0];

  return { n, rated: rated.length, dist, avg, pos, neg, mid, recentAvg, olderAvg, drift, themes, polarized, span, absent, modal };
}

const themeNoun = (name, seed) => pick(THEME_NOUNS[name] || [name], seed);
const synPct = (x) => Math.round(x * 100);
const one = (x) => (Math.round(x * 10) / 10).toFixed(1);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Priority tree: which true fact about this corpus deserves the opening line. */
function synthAngle(r, s) {
  const g = r.health_grade;
  const bad = g === 'D' || g === 'F';
  const good = g === 'A';
  const clean = s.themes.find((t) => t.name === 'cleanliness');

  if (clean && clean.share >= 0.15 && bad) return 'clean-contradict';
  if (clean && clean.share >= 0.15 && good && clean.avg != null && clean.avg <= 3) return 'clean-doubt';
  if (s.avg != null && s.avg >= 4.2 && bad) return 'wedge';
  if (s.avg != null && s.avg <= 3.3 && good) return 'inverse-wedge';
  if (Math.abs(s.drift) >= 0.8 && s.rated >= 8) return s.drift > 0 ? 'rising' : 'slipping';
  if (s.polarized) return 'polarized';
  if (s.themes[0] && s.themes[0].share >= 0.45) return 'theme-led';
  if (s.avg != null && s.avg >= 4.3 && good) return 'aligned-strong';
  if (s.avg != null && s.avg <= 3.6) return 'soft-consensus';
  return 'mixed';
}

/**
 * Original synthesis of a restaurant's reviews + DBPR record.
 * Returns null when there isn't enough corpus to say anything real.
 */
export function reviewSynthesis(r, entry) {
  const s = reviewSignals(entry);
  if (!s) return null;

  const slug = r.slug || r.license_key || '';
  const sd = (tag) => seedOf(slug + '#syn#' + tag);
  const angle = synthAngle(r, s);

  const g = r.health_grade;
  const score = Number.isFinite(r.health_score) ? r.health_score : null;
  const gradeTxt = g && g !== 'NR' ? gradeArticle(g) : null;
  const viol = violationParts(r);
  const violTxt = viol.length ? listJoin(viol) : null;
  const t0 = s.themes[0];
  const t1 = s.themes[1];
  const N = s.n;
  const avg = s.avg != null ? one(s.avg) : null;
  const cleanT = s.themes.find((t) => t.name === 'cleanliness');

  /* ---------- 1. LEAD ---------- */
  const L = [];
  if (angle === 'clean-contradict') {
    L.push(
      'Cleanliness comes up in ' + synPct(cleanT.share) + '% of the ' + N + ' reviews here, and the inspection record backs the worry up.',
      'Diners raise cleanliness often enough to notice — and on this one the state inspector agrees with them.',
      'Read these ' + N + ' reviews next to the inspection report and they tell the same story from two directions.',
      'The room gets mentioned a lot in these ' + N + ' reviews. So does it in the DBPR file.',
      'Where diners and inspectors usually diverge, here they line up: both flag the same thing.',
      'Something in these ' + N + ' reviews keeps circling back to the state of the place — and the grade explains why.'
    );
  } else if (angle === 'clean-doubt') {
    L.push(
      'A handful of these ' + N + ' reviews question how clean the place is, which the inspection record does not support.',
      'Diners who mention cleanliness here rate it low, yet the kitchen graded ' + g + '.',
      'On paper the kitchen passes; in the reviews, a few visitors were not convinced.',
      'There is a gap here worth naming: reviewers who talk about cleanliness are harder on this place than the inspector was.',
      'The inspection says one thing about this kitchen, and a minority of reviewers say another.',
      'Not every diner trusts the room — though the last inspection found little to support that.'
    );
  } else if (angle === 'wedge') {
    L.push(
      'The crowd and the kitchen disagree here, and the gap is wide.',
      avg + ' stars across ' + N + ' reviews, ' + gradeTxt + ' health grade — those two numbers are not describing the same visit.',
      'Diners rate this place well. The inspector did not.',
      'This is the pattern the site exists to surface: strong reviews, weak inspection.',
      'Popularity and sanitation part ways on this listing.',
      'Read the reviews alone and you would never guess the grade.'
    );
  } else if (angle === 'inverse-wedge') {
    L.push(
      'The kitchen grades better than the reviews do.',
      cap(gradeTxt) + ' inspection result sits behind a review average of just ' + avg + '.',
      'Complaints here are real, but they are mostly not about the kitchen.',
      'Worth separating two things on this listing: how the food is received, and how the kitchen inspects.',
      'The inspection record is the stronger half of this page.',
      'Diners are harder on this place than the health inspector was.'
    );
  } else if (angle === 'rising') {
    L.push(
      'The newer reviews here read better than the older ones — ' + one(s.recentAvg) + ' against ' + one(s.olderAvg) + '.',
      'Something changed. Recent visits score noticeably higher than earlier ones.',
      'Sorted by date, these ' + N + ' reviews trend upward.',
      'The trajectory matters more than the average on this listing.',
      'Recent diners are rating this place better than the back catalogue suggests.',
      'An average alone would undersell where this place is now.'
    );
  } else if (angle === 'slipping') {
    L.push(
      'The most recent reviews here are worse than the older ones — ' + one(s.recentAvg) + ' against ' + one(s.olderAvg) + '.',
      'The direction of travel is downward across these ' + N + ' reviews.',
      'Sorted newest-first, the ratings decline as you read up.',
      'Recent visits are landing softer than earlier ones did.',
      'The headline average flatters this listing; the recent half does not.',
      'Whatever the overall score says, the last stretch of reviews is the weaker one.'
    );
  } else if (angle === 'polarized') {
    L.push(
      'Reviews here split hard: ' + s.dist[5] + ' five-star against ' + s.dist[1] + ' one-star, with little in between.',
      'There is no middle ground in these ' + N + ' reviews.',
      'People either love this place or they do not, and the ratings show it.',
      'The ' + avg + '-star average is misleading — almost nobody actually rated it that.',
      "This listing's ratings cluster at the two ends of the scale.",
      'An average is a poor summary when the underlying reviews look like this.'
    );
  } else if (angle === 'theme-led') {
    const nounA = themeNoun(t0.name, sd('n0'));
    L.push(
      cap(nounA) + ' dominates the conversation here — it comes up in ' + synPct(t0.share) + '% of the ' + N + ' reviews.',
      'One subject runs through these ' + N + ' reviews more than any other: ' + nounA + '.',
      'Diners writing about this place keep returning to ' + nounA + '.',
      'If these ' + N + ' reviews agree on a topic, it is ' + nounA + '.',
      synPct(t0.share) + '% of reviews here touch on ' + nounA + ', more than any other theme.',
      'The recurring subject in this corpus is ' + nounA + ', not the food in general.'
    );
  } else if (angle === 'aligned-strong') {
    L.push(
      'Reviews and inspection point the same way here.',
      avg + ' stars across ' + N + ' reviews, ' + gradeTxt + ' on the inspection — a rare case where both halves agree.',
      'Little tension on this listing: diners rate it well and the kitchen graded well.',
      'The crowd and the inspector reached the same conclusion.',
      'Both measures on this page are strong, which is less common than it sounds.',
      'This is what agreement looks like: high ratings, clean inspection.'
    );
  } else if (angle === 'soft-consensus') {
    L.push(
      'The reviews here settle around ' + avg + ' stars, without much argument in either direction.',
      'No strong feelings in these ' + N + ' reviews — the ratings sit low and steady.',
      'Consensus here is lukewarm rather than hostile.',
      'These ' + N + ' reviews are more disappointed than angry.',
      'The tone across this corpus is muted.',
      'Nothing in these ' + N + ' reviews is emphatic, which is its own kind of verdict.'
    );
  } else {
    L.push(
      'Across ' + N + ' reviews, opinion here is genuinely mixed.',
      'These ' + N + ' reviews do not converge on a single verdict.',
      'Read together, this corpus is a split decision.',
      avg + ' stars from ' + N + ' reviews, with the reasoning pulling in different directions.',
      'The reviews here disagree with each other more than they disagree with the grade.',
      'No clear consensus emerges from these ' + N + ' reviews.'
    );
  }
  const lead = pick(L, sd('lead'));

  /* ---------- 2. THEME BODY ---------- */
  const body = [];
  if (t0 && t0.avg != null) {
    const n0 = themeNoun(t0.name, sd('tn0'));
    const verdict0 = t0.avg >= 4 ? 'positive' : t0.avg <= 2.8 ? 'negative' : 'mixed';
    const T = [];
    if (verdict0 === 'positive') {
      T.push(
        'Reviewers who mention ' + n0 + ' rate this place ' + one(t0.avg) + ' on average — it is working in the restaurant’s favour.',
        'Where ' + n0 + ' comes up, the rating that follows averages ' + one(t0.avg) + ', so it reads as a strength.',
        cap(n0) + ' tends to be raised approvingly here, averaging ' + one(t0.avg) + ' stars.'
      );
    } else if (verdict0 === 'negative') {
      T.push(
        'Reviews that raise ' + n0 + ' average just ' + one(t0.avg) + ' stars — this is where the complaints concentrate.',
        cap(n0) + ' is the sore point: those reviews average ' + one(t0.avg) + '.',
        'When ' + n0 + ' comes up here it is usually a criticism, and the ratings attached average ' + one(t0.avg) + '.'
      );
    } else {
      T.push(
        'Reviews mentioning ' + n0 + ' average ' + one(t0.avg) + ' stars, so it divides opinion rather than settling it.',
        cap(n0) + ' cuts both ways here, averaging ' + one(t0.avg) + ' among the reviews that raise it.',
        'Opinion on ' + n0 + ' is split — those reviews land at ' + one(t0.avg) + ' on average.'
      );
    }
    body.push(pick(T, sd('t0')));
  }
  if (t1 && t1.share >= 0.2) {
    const n1 = themeNoun(t1.name, sd('tn1'));
    const avgFrag = t1.avg != null ? one(t1.avg) : null;
    const S = [
      cap(n1) + ' is the next most common subject, in ' + synPct(t1.share) + '% of reviews' + (avgFrag ? ' (averaging ' + avgFrag + ')' : '') + '.',
      'After that, ' + n1 + ' appears most often — ' + synPct(t1.share) + '% of the corpus' + (avgFrag ? ', averaging ' + avgFrag : '') + '.',
      cap(n1) + ' follows at ' + synPct(t1.share) + '% of reviews' + (avgFrag ? ', where ratings average ' + avgFrag : '') + '.',
    ];
    body.push(pick(S, sd('t1')));
  }

  /* ---------- 3. DISTRIBUTION / RECENCY SHAPE ---------- */
  const D = [];
  if (s.rated >= 4) {
    D.push(
      'Of the ' + s.rated + ' rated reviews, ' + s.pos + ' sit at four stars or better and ' + s.neg + ' at two or below.',
      'The split is ' + s.pos + ' positive to ' + s.neg + ' negative across ' + s.rated + ' rated reviews' + (s.mid ? ', with ' + s.mid + ' in the middle' : '') + '.',
      s.pos + ' of ' + s.rated + ' rated reviews are four stars or higher; ' + s.neg + ' are two or lower.'
    );
    if (Math.abs(s.drift) >= 0.4 && angle !== 'rising' && angle !== 'slipping') {
      D.push(
        (s.drift > 0 ? 'Newer' : 'Older') + ' reviews score better than ' + (s.drift > 0 ? 'older' : 'newer') +
        ' ones (' + one(s.recentAvg) + ' recent against ' + one(s.olderAvg) + ' earlier), so direction is worth weighing alongside the average.'
      );
    }
  }
  const shape = D.length ? pick(D, sd('shape')) : null;

  /* ---------- 4. DBPR CROSS-REFERENCE — the part that exists nowhere else ---------- */
  const X = [];
  const gradeClause = score != null ? gradeArticle(g) + ' (' + score + '/100)' : gradeTxt;
  if (g && g !== 'NR') {
    if (g === 'D' || g === 'F') {
      X.push(
        'None of that is visible in a star rating: the most recent DBPR inspection graded this kitchen ' + gradeClause + (violTxt ? ', citing ' + violTxt + ' violations' : '') + '. Diner sentiment and inspection result are measuring different things here, and only one of them is checked by the state.',
        'The inspection record is the harder read. DBPR graded this kitchen ' + gradeClause + (violTxt ? ' on ' + violTxt + ' violations' : '') + ' — a verdict the review average does not reflect.',
        "Set against that, the state's own inspection graded the kitchen " + gradeClause + (violTxt ? ', with ' + violTxt + ' violations recorded' : '') + '. Reviews describe the meal; the grade describes the conditions it was made in.'
      );
      if (cleanT && cleanT.share >= 0.1) {
        X.push(
          'Notably, ' + synPct(cleanT.share) + '% of reviews here already touch on cleanliness — and the inspection agrees, grading the kitchen ' + gradeClause + (violTxt ? ' on ' + violTxt + ' violations' : '') + '. Diners were picking up on something real.'
        );
      }
    } else if (g === 'A') {
      X.push(
        'On the inspection side the picture is cleaner: DBPR graded this kitchen ' + gradeClause + (violTxt ? ', with ' + violTxt + ' violations' : ' with no violations cited') + '. Whatever the reviews argue about, sanitation is not the weak point.',
        'The health record runs ahead of the reviews. The last DBPR inspection returned ' + gradeClause + (violTxt ? ' with ' + violTxt + ' violations' : ' and no violations cited') + '.',
        'Against that, the kitchen inspects well — ' + gradeClause + (violTxt ? ', ' + violTxt + ' violations' : ', nothing cited') + ' at the most recent DBPR visit.'
      );
      if (cleanT && cleanT.avg != null && cleanT.avg <= 3 && cleanT.share >= 0.1) {
        X.push(
          'That matters because ' + synPct(cleanT.share) + '% of reviews raise cleanliness and rate it ' + one(cleanT.avg) + ' on average — a complaint the inspection record does not support, since DBPR graded the kitchen ' + gradeClause + '.'
        );
      }
    } else {
      X.push(
        'The inspection lands in between as well: DBPR graded this kitchen ' + gradeClause + (violTxt ? ', citing ' + violTxt + ' violations' : '') + '.',
        'On the health side, the most recent DBPR inspection returned ' + gradeClause + (violTxt ? ' with ' + violTxt + ' violations' : '') + ' — middling, much like the reviews.',
        'The kitchen graded ' + gradeClause + (violTxt ? ' on ' + violTxt + ' violations' : '') + ' at its last inspection, which is roughly where the reviews sit too.'
      );
    }
  } else {
    X.push(
      'There is no current health grade to weigh this against — the kitchen has no recent scoreable DBPR inspection on file, so the reviews stand alone here.',
      'Unusually, there is no inspection grade to set beside this. Without a recent scoreable DBPR record we do not assign one, so the review corpus is all there is.'
    );
  }
  const cross = pick(X, sd('cross'));

  /* ---------- 5. CLOSE ---------- */
  const C = [
    'The individual reviews are below, newest first, if you want the raw material.',
    'Full reviews follow below in the order they were left.',
    'Everything above is computed from the ' + N + ' reviews reproduced below.',
    'The reviews themselves follow, unedited and newest first.',
    'Read the originals below and judge the pattern yourself.',
    'The underlying reviews are reproduced in full underneath.',
  ];
  const close = pick(C, sd('close'));

  /* ---------- 3b. CORPUS SHAPE: modal rating, span, notable absence ---------- */
  const pool = [];
  // Skip the modal line when every rating is identical — it just restates the
  // positive/negative split sentence that precedes it.
  const spread = Object.values(s.dist).filter((c) => c > 0).length;
  if (s.modal && s.rated >= 5 && spread >= 2) {
    const [mStar, mCount] = s.modal;
    const st = String(mStar) === '1' ? '1 star' : mStar + ' stars';
    const M = [
      'The single most common rating left here is ' + st + ' (' + mCount + ' of ' + s.rated + ').',
      cap(st) + ' is the modal score, given by ' + mCount + ' of the ' + s.rated + ' reviewers who rated.',
      'More reviewers landed on ' + st + ' than any other score — ' + mCount + ' of ' + s.rated + '.',
      'If you had to pick one number to represent this corpus it would be ' + mStar + ', the most frequently given rating (' + mCount + ' reviews).',
    ];
    pool.push({ key: 'modal', text: pick(M, sd('modal')) });
  }
  if (s.span && s.span.from.slice(0, 4) !== s.span.to.slice(0, 4)) {
    const from = formatMonthYear(s.span.from), to = formatMonthYear(s.span.to);
    if (from && to) {
      const R = [
        'These reviews span ' + from + ' to ' + to + ', so they cover more than one stretch of this kitchen’s history.',
        'The corpus runs from ' + from + ' through ' + to + ' — not a single moment in time.',
        'Coverage here reaches back to ' + from + ' and forward to ' + to + '.',
        'Dates on these reviews range from ' + from + ' to ' + to + '.',
      ];
      pool.push({ key: 'span', text: pick(R, sd('span')) });
    }
  }
  const t2 = s.themes[2];
  if (t2 && t2.share >= 0.15) {
    const n2 = themeNoun(t2.name, sd('tn2'));
    const A2 = [
      cap(n2) + ' shows up in ' + synPct(t2.share) + '% of reviews as well' + (t2.avg != null ? ', averaging ' + one(t2.avg) : '') + '.',
      'A third strand, ' + n2 + ', appears in ' + synPct(t2.share) + '% of them' + (t2.avg != null ? ' at ' + one(t2.avg) + ' stars' : '') + '.',
      'Behind those, ' + n2 + ' is raised in ' + synPct(t2.share) + '% of reviews' + (t2.avg != null ? ' (' + one(t2.avg) + ' average)' : '') + '.',
    ];
    pool.push({ key: 'theme3', text: pick(A2, sd('t2')) });
  } else if (s.absent && s.absent.length) {
    const missing = themeNoun(s.absent[0], sd('abs'));
    const A3 = [
      'What nobody raises here is ' + missing + ' — it goes unmentioned across all ' + N + ' reviews.',
      'Conspicuously absent: ' + missing + ', which no reviewer brings up.',
      'No one in this corpus comments on ' + missing + ' at all.',
      'One subject never comes up here: ' + missing + '.',
    ];
    pool.push({ key: 'absent', text: pick(A3, sd('absent')) });
  }

  /* ---------- 3c. ORDER + COUNT ROTATION ----------
     The statistical blocks used to emit in a fixed sequence (split, then modal,
     then span, then third theme). Rotating only the wording still left a
     detectable rhythm across pages, so the ORDER and the NUMBER of blocks now
     rotate too, on their own per-slug seeds. Deterministic — reproducible builds.
     Every block is written position-neutral, so any order reads correctly. */
  if (shape) pool.unshift({ key: 'split', text: shape });

  // Deterministic Fisher-Yates (LCG seeded from the slug) — no Math.random.
  const shuffled = (() => {
    const a = pool.slice();
    let st = sd('order') >>> 0;
    const nxt = () => ((st = (Math.imul(st, 1103515245) + 12345) >>> 0) / 4294967296);
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(nxt() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  })();

  // Drop 0 or 1 block when there are enough to spare, so not every page runs
  // the full set. Floor of 2 keeps the section from thinning below ~150 words.
  const avail = shuffled.length;
  const drop = avail >= 4 ? sd('drop') % 2 : 0;
  const chosen = shuffled.slice(0, Math.max(2, avail - drop));
  const blockOrder = chosen.map((b) => b.key).join('>');
  const extra = chosen.map((b) => b.text);

  /* ---------- 4b. INSPECTION CONTEXT: trend, recency, percentile ---------- */
  const ctx = [];
  const insDate = r.latest_inspection_date ? formatDate(r.latest_inspection_date) : null;
  if (insDate) {
    const I = [
      'That inspection was on ' + insDate + '.',
      'The visit behind that grade was ' + insDate + '.',
      'DBPR last walked in on ' + insDate + '.',
      'That result dates from ' + insDate + '.',
    ];
    ctx.push(pick(I, sd('insdate')));
  }
  if (r.inspection_trend === 'improving' || r.inspection_trend === 'declining') {
    const up = r.inspection_trend === 'improving';
    const TR = [
      'Across its inspection history the kitchen is ' + (up ? 'improving' : 'declining') + ', which ' + (up ? 'argues for giving it the benefit of the doubt' : 'argues for reading the older reviews with caution') + '.',
      'Its inspection trajectory is ' + (up ? 'upward' : 'downward') + ' over the records we hold.',
      'The trend across inspections is ' + (up ? 'improvement' : 'decline') + '.',
    ];
    ctx.push(pick(TR, sd('trend')));
  }
  if (Number.isFinite(r.health_percentile) && r.county) {
    const P = [
      'On health score it sits safer than ' + Math.round(r.health_percentile) + '% of the ' + r.county + ' County restaurants we grade.',
      'That puts it ahead of ' + Math.round(r.health_percentile) + '% of graded kitchens in ' + r.county + ' County.',
      'Ranked against ' + r.county + ' County, it is safer than ' + Math.round(r.health_percentile) + '% of the restaurants we score.',
    ];
    ctx.push(pick(P, sd('pctile')));
  }

  /* ---------- 4c. VERDICT: what the two signals together mean ---------- */
  // The synthesis a diner actually wants: reviews and inspection measure
  // different things, so say which one carries here and why.
  const V = [];
  const goodG = g === 'A' || g === 'B';
  const badG = g === 'D' || g === 'F';
  const goodR = s.avg != null && s.avg >= 4;
  const poorR = s.avg != null && s.avg <= 3.4;
  const worstTheme = s.themes.filter((t) => t.avg != null).sort((a, b) => a.avg - b.avg)[0];
  const wtNoun = worstTheme ? themeNoun(worstTheme.name, sd('wt')) : null;

  if (badG && goodR) {
    V.push(
      'The practical read: people enjoy eating here, and the kitchen still failed its last inspection. Those are separate claims, and only the second one gets checked by anybody.',
      'Taken together, this is a place diners like and inspectors do not. A good meal and a clean kitchen are different questions.',
      'What to do with that is a judgement call — the reviews describe the experience, the grade describes the conditions behind it.'
    );
  } else if (badG && !goodR) {
    V.push(
      'Both halves of this page point the same unflattering way, which at least makes it simple.',
      'There is no tension to resolve here: reviewers and the inspector reached similar conclusions.',
      'When the crowd and the inspection agree this closely, the signal is worth taking at face value.'
    );
  } else if (goodG && poorR) {
    V.push(
      'Worth separating: the complaints above cluster on ' + (wtNoun || 'the experience') + ', not on the kitchen, which inspected well.',
      'The weak part of this listing is the experience, not the sanitation — those are different failures.',
      'If ' + (wtNoun || 'service') + ' is what you care about, the reviews are the better guide here; if it is the kitchen, the grade is.'
    );
  } else if (goodG && goodR) {
    V.push(
      'Both measures agree, which is the least complicated version of this page.',
      'Nothing here pulls in opposite directions — an unusually clean read.',
      'With both signals pointing the same way, there is little to argue about on this listing.'
    );
  } else {
    V.push(
      'Neither signal is decisive on its own here, which is why both are shown.',
      'This is a listing where the two measures each tell half the story.',
      'The honest summary is that the evidence is mixed on both sides.'
    );
  }
  const verdict = pick(V, sd('verdict'));

  /* ---------- 4d. blocks that fire on THIN corpora, so short review sets still
     get a full reading rather than a two-line stub ---------- */
  const thin = [];
  if (N < 12) {
    const SS = [
      'Worth stating plainly: ' + N + ' reviews is a small sample, so treat the percentages above as indicative rather than settled.',
      'This is a thin corpus — ' + N + ' reviews — and a couple of strong opinions move the average a long way.',
      'With only ' + N + ' reviews on file, individual visits carry a lot of weight in every figure above.',
      'Read the numbers above with the sample size in mind: ' + N + ' reviews is not many.',
    ];
    thin.push(pick(SS, sd('thin')));
  }
  // Name the actual cited violations — the most concrete DBPR detail available,
  // and something no review aggregator carries.
  const latestViol = Array.isArray(r.inspection_history) && r.inspection_history[0] && Array.isArray(r.inspection_history[0].violations)
    ? r.inspection_history[0].violations
    : [];
  if (latestViol.length) {
      // DBPR descriptions are regulatory strings with internal colons and
      // semicolons ("cross-contamination: raw foods separated; food protected
      // during prep/storage"). Keep the first clause only, or drop it — a
      // half-parsed citation reads worse than none.
      const clean1 = (d) => {
        let t = String(d || '').split(';')[0].split(':')[0].trim().toLowerCase().replace(/\.$/, '');
        return t.length >= 8 && t.length <= 58 ? t : null;
      };
      const top = latestViol.slice(0, 3).map((v) => clean1(v.description)).filter(Boolean).slice(0, 2);
    if (top.length) {
      const VD = [
        'For specifics, the last inspection cited ' + listJoin(top) + '.',
        'The citations behind that grade include ' + listJoin(top) + '.',
        'What the inspector actually wrote up: ' + listJoin(top) + '.',
        'Among the items recorded were ' + listJoin(top) + '.',
      ];
      thin.push(pick(VD, sd('violdetail')));
    }
  } else if (g && g !== 'NR') {
    const NV = [
      'No violations were recorded at that visit, which is the cleanest result available.',
      'The inspector left without citing anything — worth noting, since most visits find something.',
      'Nothing was written up at that inspection at all.',
    ];
    thin.push(pick(NV, sd('noviol')));
  }

  const paragraphs = [
    tidy([lead].concat(body).join(' ')),
    tidy(extra.filter(Boolean).join(' ')),
    tidy([cross].concat(ctx).concat(thin).join(' ')),
    tidy(verdict + ' ' + close),
  ].filter(Boolean);

  const wordCount = paragraphs.join(' ').split(/\s+/).filter(Boolean).length;
  return { angle, blockOrder, paragraphs, wordCount, reviewsAnalysed: N };
}

// ===========================================================================
// COUNTY INSPECTIONS page prose — /[county]-county/restaurant-inspections/.
// Same conventions as everything above: a priority tree picks the lead from
// the data, then phrasing rotates on independent stable per-county seeds so
// the eight pages don't read as one template with the county name swapped.
// ===========================================================================
export function inspectionsIntro(s) {
  const sd = (tag) => seedOf(`${s.slug}#insp#${tag}`);
  const county = `${s.countyName} County`;
  const n = num(s.restaurants);
  const insp = num(s.inspections);
  const top = s.violations[0];
  const enf = s.enforcementTotal;

  /* ---- lead: whichever fact about THIS county is most distinctive ---- */
  const L = [];
  if (s.pctA >= 65) {
    L.push(
      `${county} inspects well by Central Florida standards: ${s.pctA}% of the ${n} restaurants we grade here hold an A.`,
      `Across ${insp} inspections of ${n} ${county} restaurants, ${s.pctA}% currently sit at an A grade — above the regional middle.`,
      `The headline for ${county} is a high pass rate: ${s.pctA}% of graded kitchens are at an A.`
    );
  } else if (s.failing >= Math.max(8, s.restaurants * 0.06)) {
    L.push(
      `${s.failing} of the ${n} ${county} restaurants we grade are currently at a D or F.`,
      `${county} carries a visible tail: ${s.failing} kitchens sit at D or F across ${insp} inspections on file.`,
      `Of ${n} graded ${county} restaurants, ${s.failing} are failing outright — the number worth knowing before you book.`
    );
  } else if (enf >= 5) {
    L.push(
      `Florida took formal enforcement action ${num(enf)} times in ${county} across the inspections on file.`,
      `${county} has ${num(enf)} inspections that ended in enforcement rather than a routine pass.`,
      `Beyond routine visits, ${num(enf)} ${county} inspections escalated to an administrative complaint or emergency order.`
    );
  } else {
    L.push(
      `We hold ${insp} DBPR inspection records for ${n} restaurants in ${county}.`,
      `${county} runs to ${n} graded restaurants and ${insp} inspections on file.`,
      `This is what ${insp} inspections across ${n} ${county} restaurants add up to.`
    );
  }

  /* ---- support: the second-most useful framing ---- */
  const S = [
    `That works out to ${s.avgInspections} inspections per restaurant over the period, including routine visits, callbacks and complaint-driven checks.`,
    `Every restaurant here was visited at least once, and many more than once — ${s.avgInspections} times on average.`,
    `The records run ${s.avgInspections} inspections deep per restaurant, so most kitchens appear more than once.`,
  ];

  /* ---- the violation angle ---- */
  const V = [];
  if (top) {
    V.push(
      `The single most-cited problem in ${county} is code ${top.code} — ${top.official.toLowerCase()} — recorded ${num(top.count)} times at ${num(top.sites)} different restaurants.`,
      `Code ${top.code} leads the county's violation list, appearing ${num(top.count)} times across ${num(top.sites)} ${county} restaurants.`,
      `If ${county} has a recurring weakness it is code ${top.code}, cited ${num(top.count)} times at ${num(top.sites)} establishments.`
    );
  }

  return {
    lead: tidy(pick(L, sd('lead'))),
    support: tidy(pick(S, sd('support'))),
    violationLead: top ? tidy(pick(V, sd('viol'))) : null,
  };
}

// ===========================================================================
// COUNTY FAILED-INSPECTIONS prose — /[county]-county/failed-inspections/.
// Same conventions as the rest of this engine. Deliberately flat: these pages
// name real businesses in a damaging context, so every sentence states a
// counted DBPR fact and stops. No adjectives the record does not carry.
// ===========================================================================
export function failedIntro(s) {
  const sd = (tag) => seedOf(`${s.slug}#fail#${tag}`);
  const county = `${s.countyName} County`;
  const f = num(s.fCount);
  const d = num(s.dCount);
  const e = num(s.emergencyCount);

  const L = [];
  if (s.emergencyCount > 0) {
    L.push(
      `${e} of the ${num(s.published)} ${county} restaurants we publish were placed under a state emergency order. A further ${f} currently hold an F.`,
      `Florida ordered ${e} ${county} restaurants closed under an emergency order. ${f} more sit at an F grade without one.`,
      `${county} has ${e} restaurants with an emergency order on record and ${f} at an F grade.`,
      `Of ${num(s.published)} ${county} restaurants on this site, ${e} have been under a state emergency order and ${f} hold an F.`
    );
  } else {
    L.push(
      `${f} of the ${num(s.graded)} graded ${county} restaurants we publish hold an F. None is under a state emergency order.`,
      `No ${county} restaurant we publish is currently under an emergency order. ${f} hold an F grade.`,
      `${county} has ${f} restaurants at an F grade and no emergency orders on record.`
    );
  }

  const S = [
    `Adding the ${d} at a D, ${num(s.failing)} of ${num(s.graded)} graded restaurants — ${s.pctFailing}% — are below a C.`,
    `${num(s.failing)} restaurants sit at D or F, ${s.pctFailing}% of everything we grade in the county.`,
    `Counting D grades as well, ${s.pctFailing}% of graded ${county} restaurants fall below a C.`,
  ];

  return {
    lead: tidy(pick(L, sd('lead'))),
    support: tidy(pick(S, sd('support'))),
  };
}
