/**
 * Modelo de puntos esperados v2 (recomendación del "consejo"):
 *
 *   xP = P(titular) × puntos por titularidad  +  P(sale del banquillo) × puntos como suplente
 *
 *  - "Titularidad" = partido con ≥ 60 minutos (mins_played de cada jornada).
 *  - Puntos por titularidad: media ponderada por recencia (las jornadas recientes pesan más)
 *    y encogida hacia la media de su posición cuando hay pocos partidos.
 *  - Rival (opcional): fuerza defensiva/ofensiva del rival desde los resultados del calendario,
 *    encogida a la media de la liga y con efecto acotado.
 *
 * Todo con datos ANTERIORES a la jornada que se predice (sin fuga de datos), para que el
 * backtest retroactivo sea honesto. Funciones puras.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const statVal = (v) => (Array.isArray(v) ? v[0] : v); // la API da [valor, puntos]

export const XP_DEFAULTS = {
  startMins: 60,      // ≥ 60' = titular
  decay: 0.85,        // peso de cada jornada anterior respecto a la siguiente
  shrinkK: 4,         // partidos "virtuales" de la media de su posición
  subPtsPrior: 1.5,   // puntos típicos saliendo del banquillo
  rivalWeight: 0,     // 0 = sin ajuste por rival (se activa si el backtest lo justifica)
  rivalCap: 0.15,     // efecto máximo ±15 %
  homeFactor: 1,      // casa/fuera (se calibra con el backtest)
  rateWindow: 6,      // jornadas recientes para estimar la tasa de titularidad
};

/** Historia por jornada: [{ week, pts, mins, started, played }] ordenada. */
export const buildHistory = (playerMaster, startMins = XP_DEFAULTS.startMins) => {
  const stats = playerMaster?.playerStats?.length ? playerMaster.playerStats : (playerMaster?.lastStats || []);
  const byWeek = new Map();
  stats.forEach((s) => {
    if (!isNum(s?.weekNumber) || !isNum(s?.totalPoints)) return;
    const minsRaw = statVal(s.stats?.mins_played);
    const mins = isNum(minsRaw) ? minsRaw : null;
    const played = mins !== null ? mins > 0 : s.totalPoints !== 0;
    byWeek.set(s.weekNumber, {
      week: s.weekNumber,
      pts: s.totalPoints,
      mins,
      played,
      started: mins !== null ? mins >= startMins : played,
    });
  });
  return [...byWeek.values()].sort((a, b) => a.week - b.week);
};

const weightedMean = (items, value, decay) => {
  // items ordenados de antiguo a reciente; el más reciente pesa 1
  let sw = 0; let s = 0;
  items.forEach((it, i) => {
    const w = decay ** (items.length - 1 - i);
    sw += w; s += w * value(it);
  });
  return sw ? { mean: s / sw, n: sw } : { mean: null, n: 0 };
};

/** Media de puntos por titularidad de cada posición, con datos anteriores a `beforeWeek`. */
export const positionPriors = (histories, beforeWeek) => {
  const acc = {};
  histories.forEach(({ positionId, history }) => {
    history.filter((h) => h.week < beforeWeek && h.started).forEach((h) => {
      acc[positionId] = acc[positionId] || { s: 0, n: 0 };
      acc[positionId].s += h.pts; acc[positionId].n += 1;
    });
  });
  const out = {};
  Object.entries(acc).forEach(([pos, { s, n }]) => { out[pos] = n ? s / n : null; });
  return out;
};

/**
 * Fuerza de los equipos con resultados ANTERIORES a `beforeWeek`.
 * @param {Object<number, Array>} calendarByWeek  { semana: [{ localId, visitorId, localScore, visitorScore }] }
 * @returns {{ teams: Map<string,{gf:number, ga:number}>, avg: number }}  goles por partido (encogidos)
 */
export const teamStrength = (calendarByWeek, beforeWeek, shrink = 3) => {
  const raw = new Map();
  let goals = 0; let games = 0;
  Object.entries(calendarByWeek || {}).forEach(([w, matches]) => {
    if (Number(w) >= beforeWeek) return;
    (matches || []).forEach((m) => {
      if (!isNum(m?.localScore) || !isNum(m?.visitorScore)) return;
      const add = (id, gf, ga) => {
        const k = String(id);
        const t = raw.get(k) || { gf: 0, ga: 0, n: 0 };
        t.gf += gf; t.ga += ga; t.n += 1;
        raw.set(k, t);
      };
      add(m.localId ?? m.local?.id, m.localScore, m.visitorScore);
      add(m.visitorId ?? m.visitor?.id, m.visitorScore, m.localScore);
      goals += m.localScore + m.visitorScore; games += 2;
    });
  });
  const avg = games ? goals / games : 1.3;
  const teams = new Map();
  raw.forEach((t, id) => teams.set(id, {
    gf: (t.gf + shrink * avg) / (t.n + shrink),
    ga: (t.ga + shrink * avg) / (t.n + shrink),
  }));
  return { teams, avg };
};

/** Multiplicador por rival: atacantes según lo que encaja el rival; POR/DEF según lo que marca. */
export const rivalFactor = ({ positionId, rivalId, strength, weight = XP_DEFAULTS.rivalWeight, cap = XP_DEFAULTS.rivalCap }) => {
  if (!weight || !strength || rivalId == null) return 1;
  const r = strength.teams.get(String(rivalId));
  if (!r || !strength.avg) return 1;
  // POR/DEF: un rival que marca poco → más porterías a cero (efecto doble)
  const rel = positionId <= 2 ? 2 * (1 - r.gf / strength.avg) : (r.ga / strength.avg - 1);
  return 1 + Math.max(-cap, Math.min(cap, weight * rel));
};

/**
 * Predicción v2 para un jugador y una jornada, solo con su historia anterior.
 * @param {object} p
 * @param {Array}  p.history      buildHistory(...)
 * @param {number} p.positionId
 * @param {number} p.beforeWeek   jornada a predecir (se usa lo anterior)
 * @param {object} p.priors       positionPriors(...)
 * @param {number|null} [p.pStart]  prob. de ser titular (futbolfantasy); si falta, tasa reciente
 * @param {string} [p.status]
 * @param {number} [p.venue]      multiplicador casa/fuera
 * @param {number} [p.rival]      multiplicador por rival
 */
export const predictV2 = ({ history, positionId, beforeWeek, priors, pStart = null, status = 'ok', venue = 1, rival = 1, opts = {} }) => {
  const o = { ...XP_DEFAULTS, ...opts };
  if (['injured', 'suspended', 'not_available'].includes(status)) {
    return { xp: 0, pStart: 0, pSub: 0, ptsStart: null, ptsSub: null };
  }
  const past = (history || []).filter((h) => h.week < beforeWeek);
  const starts = past.filter((h) => h.started);
  const subs = past.filter((h) => h.played && !h.started);
  const prior = isNum(priors?.[positionId]) ? priors[positionId] : 4;

  const ws = weightedMean(starts, (h) => h.pts, o.decay);
  const ptsStart = ws.n ? (ws.n * ws.mean + o.shrinkK * prior) / (ws.n + o.shrinkK) : prior;
  const wsub = weightedMean(subs, (h) => h.pts, o.decay);
  const ptsSub = wsub.n ? (wsub.n * wsub.mean + 2 * o.subPtsPrior) / (wsub.n + 2) : o.subPtsPrior;

  // Probabilidades: la de futbolfantasy (titularidad) si existe; si no, la tasa reciente
  const recent = past.slice(-o.rateWindow);
  const rate = (fn) => (recent.length ? weightedMean(recent, (h) => (fn(h) ? 1 : 0), o.decay).mean : null);
  const startRate = rate((h) => h.started);
  const subRate = rate((h) => h.played && !h.started);
  let ps = isNum(pStart) ? pStart : (startRate ?? 0.5);
  if (status === 'doubtful' && !isNum(pStart)) ps *= 0.6;
  const notStartRate = startRate !== null ? 1 - startRate : 0;
  const subGivenNoStart = notStartRate > 0.05 && subRate !== null ? Math.min(0.9, subRate / notStartRate) : 0.3;
  const pSub = (1 - ps) * subGivenNoStart;

  const xp = (ps * ptsStart + pSub * ptsSub) * venue * rival;
  return { xp: Math.max(0, xp), pStart: ps, pSub, ptsStart, ptsSub };
};

/**
 * Contexto para la previsión en producción: medias por posición (todos los jugadores
 * de la liga), fuerza de los equipos y próximo partido de cada equipo.
 */
export const buildXpContext = ({ playerMasters = [], calendarByWeek = {}, nextWeek = null }) => {
  const histories = playerMasters.filter((pm) => pm && pm.positionId !== 5)
    .map((pm) => ({ positionId: pm.positionId, history: buildHistory(pm) }));
  const fixtures = new Map();
  (calendarByWeek[nextWeek] || []).forEach((m) => {
    const l = String(m.localId ?? m.local?.id ?? '');
    const v = String(m.visitorId ?? m.visitor?.id ?? '');
    if (!l || !v) return;
    fixtures.set(l, { home: true, rivalId: v });
    fixtures.set(v, { home: false, rivalId: l });
  });
  return {
    priors: positionPriors(histories, Infinity),
    strength: teamStrength(calendarByWeek, nextWeek ?? Infinity),
    fixtures,
  };
};
