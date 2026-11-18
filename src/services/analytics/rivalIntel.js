/**
 * Inteligencia de rivales:
 *  - Sobrepuja: cuánto por encima del valor de mercado pagó cada manager en
 *    sus fichajes del mercado (tipo 31). El valor en la fecha de compra se
 *    interpola con el histórico de futbolfantasy (hoy, −1, −2, −3, −7, −14,
 *    −30 días), así que solo cubre compras de los últimos 30 días.
 *  - Actividad reciente (compras/ventas en los últimos N días).
 *  - Gasto en subidas de cláusula detectado comparando capturas diarias.
 * Funciones puras.
 */

const DAY = 24 * 3600 * 1000;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Valor del jugador hace `daysAgo` días, interpolando el histórico de futbolfantasy. */
export const valueDaysAgo = (trend, daysAgo) => {
  if (!trend || !isNum(daysAgo) || daysAgo < 0 || daysAgo > 30) return null;
  const pts = [[0, trend.valor], [1, trend.valor1], [2, trend.valor2], [3, trend.valor3], [7, trend.valor7], [14, trend.valor14], [30, trend.valor30]]
    .filter(([, v]) => isNum(v) && v > 0);
  for (let i = 0; i < pts.length - 1; i++) {
    const [d0, v0] = pts[i];
    const [d1, v1] = pts[i + 1];
    if (daysAgo >= d0 && daysAgo <= d1) return v0 + ((v1 - v0) * (daysAgo - d0)) / (d1 - d0);
  }
  return null;
};

const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

const summarize = (list) => {
  const s = list.map((x) => x.overbidPct).sort((a, b) => a - b);
  return {
    n: s.length,
    median: quantile(s, 0.5),
    p75: quantile(s, 0.75),
    max: s.length ? s[s.length - 1] : null,
    mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : null,
  };
};

/**
 * @param {object} p
 * @param {object} p.ledger                  buildLedger(...)
 * @param {(playerId: string) => object|null} p.trendById  tendencia futbolfantasy por id
 * @param {Date}   [p.now]
 */
export const buildBidStats = ({ ledger, trendById, now = new Date() }) => {
  const samples = [];
  for (const pch of ledger?.purchases || []) {
    if (pch.via !== 'mercado' || !isNum(pch.price) || pch.price <= 0) continue;
    const daysAgo = (now - new Date(pch.date)) / DAY;
    if (daysAgo > 30) continue;
    const value = valueDaysAgo(trendById(pch.playerId), daysAgo);
    if (!isNum(value) || value <= 0) continue;
    samples.push({ ...pch, valueAtDate: value, overbidPct: ((pch.price - value) / value) * 100 });
  }
  const byManager = new Map();
  samples.forEach((s) => {
    const list = byManager.get(s.managerId) || [];
    list.push(s);
    byManager.set(s.managerId, list);
  });
  return {
    overall: summarize(samples),
    byManager: new Map([...byManager.entries()].map(([id, list]) => [id, { ...summarize(list), samples: list }])),
  };
};

/** Compras y ventas de cada manager en los últimos `days` días. */
export const recentActivity = (ledger, { days = 7, now = new Date() } = {}) => {
  const since = now.getTime() - days * DAY;
  const out = new Map();
  const get = (id) => {
    if (!out.has(id)) out.set(id, { buys: 0, buySpend: 0, sells: 0, sellIncome: 0 });
    return out.get(id);
  };
  (ledger?.purchases || []).forEach((p) => {
    if (new Date(p.date).getTime() < since) return;
    const r = get(p.managerId);
    r.buys += 1;
    r.buySpend += p.price || 0;
  });
  (ledger?.sales || []).forEach((s) => {
    if (new Date(s.sellDate).getTime() < since) return;
    const r = get(s.managerId);
    r.sells += 1;
    r.sellIncome += s.sellPrice || 0;
  });
  return out;
};

/**
 * Subidas de cláusula entre dos capturas diarias (mismo jugador y mismo
 * dueño, sin compra entre medias). Devuelve el aumento por manager.
 * El coste real de subir una cláusula no lo publica la API: se aplica
 * `costFactor` (por defecto 0,5 = la mitad del aumento) y es ajustable.
 */
export const clauseRaisesBetween = (prevSnap, currSnap, { costFactor = 0.5 } = {}) => {
  const prev = new Map();
  (prevSnap?.teams || []).forEach((t) => t.players.forEach((p) => prev.set(`${t.managerId}:${p.id}`, p)));
  const out = new Map();
  (currSnap?.teams || []).forEach((t) => t.players.forEach((p) => {
    const before = prev.get(`${t.managerId}:${p.id}`);
    if (!before || !isNum(before.clause) || !isNum(p.clause)) return;
    const inc = p.clause - before.clause;
    // Pequeñas variaciones pueden venir de cambios automáticos; solo subidas claras
    if (inc > 100_000) {
      const r = out.get(t.managerId) || { raises: 0, increase: 0, estimatedCost: 0 };
      r.raises += 1;
      r.increase += inc;
      r.estimatedCost += inc * costFactor;
      out.set(t.managerId, r);
    }
  }));
  return out;
};

/** Puja sugerida para ganar con la sobrepuja habitual de la liga (p75 por defecto). */
export const suggestedBid = (price, overall, { quantileKey = 'p75' } = {}) => {
  const pct = overall?.[quantileKey];
  if (!isNum(price) || !isNum(pct) || (overall?.n || 0) < 5) return null;
  return Math.round(price * (1 + Math.max(0, pct) / 100));
};
