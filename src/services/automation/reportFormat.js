/** Formateadores compartidos por el informe en Markdown y en HTML/PDF. */
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const M = (v, d = 1) => (isNum(v) ? `${(v / 1e6).toFixed(d).replace('.', ',')} M` : '—');
// Con signo; las cantidades que redondean a 0 se muestran sin signo ("0,0 M", nunca "−0,0 M")
export const SM = (v, d = 1) => {
  if (!isNum(v)) return '—';
  if (Math.abs(v) < 0.5 * 10 ** (6 - d)) return M(0, d);
  return `${v >= 0 ? '+' : '−'}${M(Math.abs(v), d)}`;
};
// Variación diaria: en miles, o en millones a partir de 1 M ("+1,29 M")
export const K = (v) => {
  if (!isNum(v)) return '—';
  const sign = v >= 0 ? '+' : '−';
  const a = Math.abs(v);
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2).replace('.', ',')} M`;
  if (a < 500) return '0K';
  return `${sign}${Math.round(a / 1e3)}K`;
};
export const N = (v, d = 1) => (isNum(v) ? v.toFixed(d).replace('.', ',') : '—');
export const PCT = (v) => (isNum(v) ? `${v >= 0 ? '+' : '−'}${N(Math.abs(v), 0)} %` : '—');
// Porcentaje con 2 decimales (crecimientos diarios: suelen ser < 1 %)
export const PCT2 = (v) => (isNum(v) ? `${v >= 0 ? '+' : '−'}${N(Math.abs(v), 2)} %` : '—');
export const dt = (v) => (v ? new Date(v).toLocaleString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export const STATUS_ICON = { ok: '', injured: '🚑', doubtful: '❓', suspended: '🟥', not_available: '⛔' };
export const LINE_LABEL = { 1: 'POR', 2: 'DEF', 3: 'MED', 4: 'DEL' };
export const trendArrow = (v) => (!isNum(v) ? '' : v > 20_000 ? '▲' : v < -20_000 ? '▼' : '→');
export const venueIcon = (r) => (r.nextIsHome === true ? '🏠' : r.nextIsHome === false ? '✈️' : '');
