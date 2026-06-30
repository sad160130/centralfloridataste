// Composite "Overall Score" — a transparent, presentation-layer roll-up that is
// deliberately DISTINCT from the state-derived health grade. Every component
// traces to a real stored field and always resolves to a finite number (never
// null), so the breakdown bars never render a gap.
//
// Component maxes: health 40 + dietary 20 + hidden-gem 10 + community 20 +
// track record 10 = 100. A perfect profile reaches a true 100.
import { titleCase } from './format.js';

const GRADE_POINTS = { A: 40, B: 30, C: 20, D: 10, F: 0 };
const DIETARY_FULL = 6; // 6+ listed dietary options earns full transparency marks
const TREND_POINTS = { improving: 6, stable: 4, declining: 2 };

export const SCORE_DENOMINATOR = 100;

const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

// avgStars: the community average actually shown on the page (Google rating when
// present), passed in so the score and the headline rating can't disagree.
export function compositeScore(r, { avgStars = null } = {}) {
  /* Health inspection grade → up to 40 (A=40 … F=0) */
  const grade = r.health_grade;
  const health = Object.prototype.hasOwnProperty.call(GRADE_POINTS, grade)
    ? GRADE_POINTS[grade]
    : 0;

  /* Dietary transparency → up to 20, scaled by how many flags are set */
  const flags = Array.isArray(r.dietary) ? r.dietary.length : 0;
  const dietary = Math.round((Math.min(flags, DIETARY_FULL) / DIETARY_FULL) * 20);

  /* Hidden-gem status → 10 or 0 */
  const hidden = r.hidden_gem ? 10 : 0;

  /* Community rating → up to 20, scaled from the average star rating */
  const stars = Number.isFinite(avgStars)
    ? avgStars
    : Number.isFinite(r.rating)
      ? r.rating
      : null;
  const community = stars != null ? Math.round((clamp(stars, 0, 5) / 5) * 20) : 0;

  /* Track record → up to 10, from inspection trend + share of clean inspections */
  const trendPts = TREND_POINTS[r.inspection_trend] ?? 0;
  const history = Array.isArray(r.inspection_history) ? r.inspection_history : [];
  const cleanCount = history.filter(
    (h) => (h.high || 0) + (h.intermediate || 0) + (h.basic || 0) === 0
  ).length;
  const cleanShare = history.length ? cleanCount / history.length : 0;
  const track = clamp(trendPts + Math.round(cleanShare * 4), 0, 10);

  const components = [
    {
      key: 'health',
      label: 'Health inspection grade',
      score: health,
      max: 40,
      detail: grade && grade !== 'NR' ? `Grade ${grade}` : 'Not graded',
    },
    {
      key: 'dietary',
      label: 'Dietary transparency',
      score: dietary,
      max: 20,
      detail: flags ? `${flags} option${flags === 1 ? '' : 's'} listed` : 'None listed',
    },
    {
      key: 'community',
      label: 'Community rating',
      score: community,
      max: 20,
      detail: stars != null ? `${stars.toFixed(1)}★ average` : 'No rating',
    },
    {
      key: 'hidden',
      label: 'Hidden-gem status',
      score: hidden,
      max: 10,
      detail: r.hidden_gem ? 'Flagged hidden gem' : 'Not flagged',
    },
    {
      key: 'track',
      label: 'Track record',
      score: track,
      max: 10,
      detail: r.inspection_trend
        ? `${titleCase(r.inspection_trend)}${history.length ? `, ${Math.round(cleanShare * 100)}% clean` : ''}`
        : 'No record',
    },
  ];

  const total = components.reduce((s, c) => s + c.score, 0);
  return { total, denominator: SCORE_DENOMINATOR, components };
}
