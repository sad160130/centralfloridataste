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
