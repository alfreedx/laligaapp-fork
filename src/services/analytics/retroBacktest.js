/**
 * Backtest retroactivo del xP sobre las jornadas ya jugadas.
 *
 * Para cada jornada J y cada variante del modelo se predice con datos < J
 * (sin fuga) y se mide:
 *   - MAE (error medio absoluto) por jugador;
 *   - Spearman dentro de cada posición (¿ordena bien?);
 *   - regret: puntos que pierde el once elegido con el modelo frente al mejor
 *     once posible a posteriori, para cada plantilla de la liga (la métrica que gana ligas);
 *   - intervalo bootstrap (por jornadas, pareado) de la diferencia de regret
 *     respecto al modelo actual: si no excluye el 0, la mejora puede ser ruido.
 * Funciones puras.
 */
import { bestLineup } from './forecast';
import { positionPriors, predictV2, teamStrength, rivalFactor } from './xpModel';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

export const VARIANTS_V2 = {
  actual: 'Modelo actual (0,6 media + 0,4 forma, casa/fuera fijo)',
  media: 'Solo media × tasa de juego',
  v2: 'Nuevo: titular/suplente + encogimiento + recencia',
  v2_casa: 'Nuevo + casa/fuera ±5 %',
  v2_rival: 'Nuevo + rival',
  v2_rival_casa: 'Nuevo + rival + casa/fuera',
};

/** Rango medio (empates promediados). */
const ranks = (vals) => {
  const idx = vals.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(vals.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
};

export const spearman = (x, y) => {
  if (x.length < 3) return null;
  const rx = ranks(x); const ry = ranks(y);
  const mx = mean(rx); const my = mean(ry);
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
};

/** Generador pseudoaleatorio con semilla (resultados reproducibles). */
const rng = (seed) => () => {
  // eslint-disable-next-line no-bitwise
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};

export const bootstrapCI = (diffs, iters = 2000, seed = 42) => {
  if (diffs.length < 3) return null;
  const rand = rng(seed);
  const means = [];
  for (let b = 0; b < iters; b++) {
    let s = 0;
    for (let i = 0; i < diffs.length; i++) s += diffs[Math.floor(rand() * diffs.length)];
    means.push(s / diffs.length);
  }
  means.sort((a, b) => a - b);
  return { lo: means[Math.floor(0.025 * iters)], hi: means[Math.floor(0.975 * iters)] };
};

/** Partido de un equipo en una jornada: { home, rivalId } o null (aplazado / sin datos). */
const fixtureOf = (matches, teamId) => {
  const m = (matches || []).find((x) => String(x.localId ?? x.local?.id) === String(teamId) || String(x.visitorId ?? x.visitor?.id) === String(teamId));
  if (!m) return null;
  const home = String(m.localId ?? m.local?.id) === String(teamId);
  return { home, rivalId: home ? (m.visitorId ?? m.visitor?.id) : (m.localId ?? m.local?.id) };
};

/** Predicción del modelo actual, replicado sin fuga (medias con jornadas < J). */
const predictCurrent = (history, beforeWeek, home) => {
  const past = history.filter((h) => h.week < beforeWeek);
  const played = past.filter((h) => h.played);
  if (!past.length) return null;
  const avg = played.length ? mean(played.map((h) => h.pts)) : 0;
  const last3 = past.slice(-3);
  const form = mean(last3.map((h) => h.pts));
  const base = 0.6 * avg + 0.4 * form;
  const recent = past.slice(-6);
  const prob = recent.filter((h) => h.played).length / recent.length;
  const venue = home === true ? 1.08 : home === false ? 0.93 : 1;
  return { xp: Math.max(0, base) * venue * prob, avg, prob };
};

/**
 * @param {object} p
 * @param {Array}  p.players   [{ id, name, positionId, teamId, history }] (sin entrenadores)
 * @param {Object} p.calendarByWeek  { semana: partidos con localId/visitorId/localScore/visitorScore }
 * @param {Array<Array<string>>} p.squads  ids de jugadores de cada plantilla de la liga
 * @param {number[]} p.weeks   jornadas a evaluar
 */
export const runRetroBacktest = ({ players, calendarByWeek, squads, weeks }) => {
  const perWeek = {};
  const variants = Object.keys(VARIANTS_V2);

  weeks.forEach((J) => {
    const priors = positionPriors(players, J);
    const strength = teamStrength(calendarByWeek, J);
    const preds = {}; // variante → Map(id → xp)
    variants.forEach((v) => { preds[v] = new Map(); });
    const actual = new Map();

    players.forEach((pl) => {
      const fx = fixtureOf(calendarByWeek[J], pl.teamId);
      const entry = pl.history.find((h) => h.week === J);
      if (!fx || !entry) return; // sin partido o sin dato: no se evalúa
      if (!pl.history.some((h) => h.week < J)) return; // sin historia previa
      actual.set(pl.id, entry.pts);
      const cur = predictCurrent(pl.history, J, fx.home);
      preds.actual.set(pl.id, cur?.xp ?? 0);
      preds.media.set(pl.id, cur ? cur.avg * cur.prob : 0);
      const casa = fx.home ? 1.05 : 0.95;
      const riv = rivalFactor({ positionId: pl.positionId, rivalId: fx.rivalId, strength, weight: 0.5 });
      const base = { history: pl.history, positionId: pl.positionId, beforeWeek: J, priors };
      preds.v2.set(pl.id, predictV2(base).xp);
      preds.v2_casa.set(pl.id, predictV2({ ...base, venue: casa }).xp);
      preds.v2_rival.set(pl.id, predictV2({ ...base, rival: riv }).xp);
      preds.v2_rival_casa.set(pl.id, predictV2({ ...base, venue: casa, rival: riv }).xp);
    });
    if (actual.size < 20) return;

    const byId = new Map(players.map((p) => [p.id, p]));
    perWeek[J] = {};
    variants.forEach((v) => {
      const ids = [...actual.keys()];
      const mae = mean(ids.map((id) => Math.abs(preds[v].get(id) - actual.get(id))));
      const sp = [1, 2, 3, 4].map((pos) => {
        const pids = ids.filter((id) => byId.get(id).positionId === pos);
        return spearman(pids.map((id) => preds[v].get(id)), pids.map((id) => actual.get(id)));
      }).filter(isNum);
      // Regret por plantilla: once elegido con el modelo vs mejor once a posteriori
      const regrets = squads.map((ids2) => {
        const squad = ids2.map((id) => byId.get(id)).filter(Boolean);
        if (squad.length < 11) return null;
        const real = (id) => actual.get(id) ?? 0;
        const chosen = bestLineup(squad.map((p) => ({ ...p, xp: preds[v].get(p.id) ?? 0 })));
        const oracle = bestLineup(squad.map((p) => ({ ...p, xp: real(p.id) })));
        const score = (lu) => lu.starters.reduce((s, p) => s + real(p.id), 0) + (lu.captain ? real(lu.captain.id) : 0);
        return score(oracle) - score(chosen);
      }).filter(isNum);
      perWeek[J][v] = { mae, spearman: mean(sp), regret: mean(regrets), n: ids.length };
    });
  });

  const evaluated = Object.keys(perWeek).map(Number).sort((a, b) => a - b);
  const summary = {};
  variants.forEach((v) => {
    const col = (k) => mean(evaluated.map((w) => perWeek[w][v][k]).filter(isNum));
    const diffs = evaluated.map((w) => perWeek[w][v].regret - perWeek[w].actual.regret).filter(isNum);
    summary[v] = {
      label: VARIANTS_V2[v],
      mae: col('mae'),
      spearman: col('spearman'),
      regret: col('regret'),
      regretDiffVsActual: mean(diffs),
      ci: v === 'actual' ? null : bootstrapCI(diffs),
    };
  });
  return { weeks: evaluated, summary, perWeek };
};
