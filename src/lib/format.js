// Shared display/formatting helpers. Never emit "null"/"undefined".

export const titleCase = (s) =>
  (s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const formatDate = (iso) => {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
};

export const listJoin = (arr) => {
  if (!arr || arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(', ')}, and ${arr[arr.length - 1]}`;
};

// Hub list ordering: best health grade first, then score, then name.
const gradeRank = (g) => (g === 'A' ? 0 : g === 'B' ? 1 : g === 'C' ? 2 : 3);
export const sortForHub = (a, b) => {
  const gr = gradeRank(a.health_grade) - gradeRank(b.health_grade);
  if (gr) return gr;
  const sa = Number.isFinite(a.health_score) ? a.health_score : -1;
  const sb = Number.isFinite(b.health_score) ? b.health_score : -1;
  if (sb - sa) return sb - sa;
  return String(a.name).localeCompare(String(b.name));
};
