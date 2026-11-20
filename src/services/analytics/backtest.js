/**
 * Comprobación de la previsión de puntos: se guarda la previsión antes de
 * cada jornada y, cuando termina, se compara con los puntos reales.
 * Compara el modelo con dos alternativas sencillas para saber si compensa.
 * Funciones puras.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const VARIANTS = {
  modelo: 'Modelo v2 (titular/suplente + rival)',
  media: 'Solo media de temporada',
  forma: 'Solo forma (3 jornadas)',
};

/** Previsión compacta por jugador para guardar antes de la jornada. */
export const buildPredictionRecord = (rows, { lineupIds = [], captainId = null } = {}) => {
  const players = {};
  rows.forEach((r) => {
    if (!r?.id || r.positionId === 5 || !isNum(r.playProb)) return;
    const k = r.playProb * (r.venueFactor ?? 1);
    players[r.id] = {
      n: r.name,
      modelo: isNum(r.xp) ? r.xp : null,
      media: isNum(r.seasonAvg) ? r.seasonAvg * k : null,
      forma: isNum(r.form ?? r.seasonAvg) ? (r.form ?? r.seasonAvg) * k : null,
    };
  });
  return { createdAt: new Date().toISOString(), players, lineupIds, captainId };
};

/**
 * Puntos reales de la jornada `week` desde lastStats de los jugadores con
 * plantilla. Si el jugador tiene estadísticas que cubren esa jornada pero no
 * aparece, se cuenta 0 (no jugó).
 */
export const actualPointsForWeek = (teams, week) => {
  const out = new Map();
  (teams || []).forEach((t) => t.players.forEach((pt) => {
    const pm = pt.playerMaster;
    if (!pm?.id || pm.positionId === 5) return;
    const stats = pm.lastStats || pm.playerStats || [];
    if (!stats.length) return;
    const weeks = stats.map((s) => s.weekNumber).filter(isNum);
    const entry = stats.find((s) => s.weekNumber === week);
    if (entry && isNum(entry.totalPoints)) out.set(String(pm.id), entry.totalPoints);
    else if (weeks.length && Math.min(...weeks) <= week && Math.max(...weeks) >= week) out.set(String(pm.id), 0);
  }));
  return out;
};

/** Error de cada variante para una jornada. */
export const evaluateWeek = (record, actual) => {
  const res = {};
  Object.keys(VARIANTS).forEach((v) => {
    let n = 0; let abs = 0; let bias = 0;
    Object.entries(record?.players || {}).forEach(([id, p]) => {
      if (!actual.has(id) || !isNum(p[v])) return;
      const err = p[v] - actual.get(id);
      n += 1; abs += Math.abs(err); bias += err;
    });
    res[v] = { n, mae: n ? abs / n : null, bias: n ? bias / n : null };
  });

  const misses = Object.entries(record?.players || {})
    .filter(([id, p]) => actual.has(id) && isNum(p.modelo))
    .map(([id, p]) => ({ id, name: p.n, predicted: p.modelo, actual: actual.get(id), error: p.modelo - actual.get(id) }))
    .sort((a, b) => Math.abs(b.error) - Math.abs(a.error))
    .slice(0, 5);

  // Mi once recomendado: previsto vs real (capitán ×2)
  let lineup = null;
  if (record?.lineupIds?.length) {
    let pred = 0; let real = 0; let known = 0;
    record.lineupIds.forEach((id) => {
      const mult = id === record.captainId ? 2 : 1;
      const p = record.players[id]?.modelo;
      if (isNum(p)) pred += p * mult;
      if (actual.has(id)) { real += actual.get(id) * mult; known += 1; }
    });
    lineup = { predicted: pred, actual: real, known, total: record.lineupIds.length };
  }
  return { variants: res, misses, lineup };
};

/** Variante con menor error medio acumulado (ponderado por nº de jugadores). */
export const bestVariant = (evaluations) => {
  const acc = {};
  Object.values(evaluations || {}).forEach((ev) => Object.entries(ev.variants || {}).forEach(([v, r]) => {
    if (!r.n) return;
    acc[v] = acc[v] || { n: 0, abs: 0 };
    acc[v].n += r.n;
    acc[v].abs += r.mae * r.n;
  }));
  const ranked = Object.entries(acc).map(([v, a]) => ({ variant: v, mae: a.abs / a.n, n: a.n })).sort((a, b) => a.mae - b.mae);
  return ranked;
};
