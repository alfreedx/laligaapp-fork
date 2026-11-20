/**
 * Filtros de la página de Rentabilidad. Funciones puras sobre las filas de
 * rows.js (squad / market / rivals).
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const H = 3600 * 1000;

export const EMPTY_FILTERS = {
  clause: 'all',        // all | open | 24h | 48h | 7d | closed | shielded
  clauseVsValue: 'all', // all | lt10 | 10-25 | 25-50 | 50-100 | gt100
  valueMin: '',         // millones
  valueMax: '',
  trend: 'all',         // all | up | down
  status: 'all',        // all | ok | issues
  minXp: '',
  minProb: 'all',       // all | 50 | 70 | 90
  owner: 'all',
  affordable: false,    // precio / cláusula ≤ mi saldo
  profitable: false,    // ganancia en N días vendiendo a LaLiga > 0
};

export const CLAUSE_VS_VALUE_RANGES = {
  lt10: [-Infinity, 10], '10-25': [10, 25], '25-50': [25, 50], '50-100': [50, 100], gt100: [100, Infinity],
};

/** Cuánto supera la cláusula al valor de mercado, en %. */
export const clauseOverValue = (r) => (isNum(r.clause) && isNum(r.value) && r.value > 0 ? (r.clause / r.value - 1) * 100 : null);

const hoursToOpen = (r, now) => {
  if (r.clauseIsOpen) return 0;
  const t = r.clauseOpenAt ? new Date(r.clauseOpenAt).getTime() : NaN;
  return Number.isFinite(t) ? Math.max(0, (t - now.getTime()) / H) : null;
};

/** Precio que habría que pagar por la fila: cláusula (rivales) o precio de venta (mercado). */
const costOf = (r, tab) => (tab === 'rivals' ? r.clause : tab === 'market' ? r.buyPrice : null);

export const countActiveFilters = (f) => Object.entries(f).filter(([k, v]) => v !== EMPTY_FILTERS[k]).length;

export const applyFilters = (rows, f, { tab, myMoney = null, rate = 'dailyGrowth', now = new Date() } = {}) => (rows || []).filter((r) => {
  // Cláusula
  if (f.clause !== 'all') {
    if (f.clause === 'shielded') { if (!r.isShielded) return false; } else {
      if (r.isShielded || !isNum(r.clause)) return false;
      const h = hoursToOpen(r, now);
      if (f.clause === 'open' && !r.clauseIsOpen) return false;
      if (f.clause === 'closed' && r.clauseIsOpen) return false;
      const lim = { '24h': 24, '48h': 48, '7d': 168 }[f.clause];
      if (lim && !(h !== null && h <= lim)) return false;
    }
  }
  if (f.clauseVsValue !== 'all') {
    const pct = clauseOverValue(r);
    const [lo, hi] = CLAUSE_VS_VALUE_RANGES[f.clauseVsValue] || [-Infinity, Infinity];
    if (!isNum(pct) || pct < lo || pct >= hi) return false;
  }
  // Valor
  const vMin = parseFloat(String(f.valueMin).replace(',', '.'));
  const vMax = parseFloat(String(f.valueMax).replace(',', '.'));
  if (Number.isFinite(vMin) && !(isNum(r.value) && r.value >= vMin * 1e6)) return false;
  if (Number.isFinite(vMax) && !(isNum(r.value) && r.value <= vMax * 1e6)) return false;
  // Tendencia (según el ritmo elegido)
  if (f.trend !== 'all') {
    const g = r[rate];
    if (!isNum(g) || (f.trend === 'up' ? g <= 0 : g >= 0)) return false;
  }
  // Deportivo
  if (f.status === 'ok' && r.status && r.status !== 'ok') return false;
  if (f.status === 'issues' && (!r.status || r.status === 'ok')) return false;
  const xpMin = parseFloat(String(f.minXp).replace(',', '.'));
  if (Number.isFinite(xpMin) && !(isNum(r.xp) && r.xp >= xpMin)) return false;
  if (f.minProb !== 'all' && !(isNum(r.playProb) && r.playProb * 100 >= Number(f.minProb))) return false;
  // Dueño / vendedor
  if (f.owner !== 'all' && (r.owner || r.seller) !== f.owner) return false;
  // Dinero
  if (f.affordable) {
    const c = costOf(r, tab);
    if (!isNum(c) || !isNum(myMoney) || c > myMoney) return false;
  }
  if (f.profitable) {
    const g = tab === 'rivals' ? r.clauseGainN : r.gainNLaLiga;
    if (!isNum(g) || g <= 0) return false;
  }
  return true;
});
