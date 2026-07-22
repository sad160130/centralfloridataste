// Structured-data representation of OUR calculated health grade.
//
// Why this exists: the Restaurant node's only rating was `aggregateRating`,
// which carries the *diner* star rating. A machine reading the entity saw a
// review site and never saw the health grade — the site's actual differentiator.
//
// Honesty constraints (must match the page and /methodology/):
//   * Florida issues no official restaurant letter grades. This is expressed as
//     a critic-style Review AUTHORED BY THIS SITE, never as a government or
//     official rating.
//   * The 0–100 scale is stated explicitly (bestRating/worstRating) so the score
//     can't be misread as a 5-star value.
//   * Unrated records (NR, or any row without a finite score) get NOTHING —
//     we never assert a grade we don't have.

const GRADES = new Set(['A', 'B', 'C', 'D', 'F']);

/** True only when we hold a real A–F grade with a finite 0–100 score. */
export function hasCalculatedGrade(r) {
  return (
    GRADES.has(String(r.health_grade)) &&
    Number.isFinite(r.health_score) &&
    r.health_score >= 0 &&
    r.health_score <= 100
  );
}

/**
 * A Review authored by the site (referenced by publisher @id) whose
 * reviewRating carries the 0–100 score and the A–F letter.
 * Returns null when the restaurant is unrated.
 */
export function healthGradeReview(r, orgId) {
  if (!hasCalculatedGrade(r)) return null;

  const grade = String(r.health_grade);
  const score = r.health_score;

  return {
    '@type': 'Review',
    name: `Calculated health grade ${grade} (${score}/100)`,
    author: { '@id': orgId },
    reviewAspect: 'Health and sanitation',
    ...(r.latest_inspection_date ? { datePublished: r.latest_inspection_date } : {}),
    reviewBody:
      `Calculated health grade ${grade} (${score} out of 100), derived from this ` +
      `restaurant's most recent Florida DBPR public inspection record. Florida ` +
      `does not issue official restaurant letter grades; this grade is calculated ` +
      `by this guide from public records using a consistently applied, published method.`,
    reviewRating: {
      '@type': 'Rating',
      ratingValue: score,
      bestRating: 100,
      worstRating: 0,
      alternateName: `Grade ${grade}`,
      ratingExplanation:
        'Calculated by this guide from Florida DBPR public inspection records on a ' +
        '0–100 scale (A 90+, B 80–89, C 70–79, D 60–69, F below 60). Not an official ' +
        'State of Florida grade — Florida issues none.',
    },
  };
}

/**
 * The same facts as plain PropertyValue entries, so the grade stays
 * machine-readable even for consumers that ignore review markup.
 * Returns [] when the restaurant is unrated.
 */
export function healthGradeProperties(r) {
  if (!hasCalculatedGrade(r)) return [];
  return [
    {
      '@type': 'PropertyValue',
      name: 'Calculated health grade',
      value: String(r.health_grade),
      description: 'Calculated by this guide from Florida DBPR records — not an official state grade.',
    },
    {
      '@type': 'PropertyValue',
      name: 'Calculated health score',
      value: r.health_score,
      minValue: 0,
      maxValue: 100,
    },
  ];
}
