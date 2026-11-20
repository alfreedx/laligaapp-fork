/**
 * Previsión de puntos para la próxima jornada y optimizador de alineación.
 *
 * Modelo v2 (validado con un backtest retroactivo sobre las jornadas jugadas,
 * ver xpModel.js y retroBacktest.js):
 *   xP = P(titular) × puntos por titularidad + P(sale del banquillo) × puntos como suplente
 *        × factor rival (fuerza del rival según el calendario, ±15 % como máximo)
 *  - Puntos por titularidad: media ponderada por recencia de los partidos con ≥ 60',
 *    encogida hacia la media de su posición si hay pocos partidos.
 *  - P(titular): la de futbolfantasy si existe; si no, su tasa reciente de titularidades.
 *  - Casa/fuera: sin efecto (en el backtest no mejoraba la previsión).
 * Entrenadores: media de temporada y forma (como antes).
 *
 * El contexto (medias por posición, fuerza de equipos y próximos partidos) lo
 * prepara buildXpContext con los datos de la liga; sin contexto se usan valores por defecto.
 */
import { buildHistory, predictV2, rivalFactor } from './xpModel';

const FALLBACK_PROB = { ok: 0.6, doubtful: 0.4, injured: 0, suspended: 0, not_available: 0 };
export const RIVAL_WEIGHT = 0.5;
// Media de puntos por titularidad por posición cuando no hay contexto de liga
const DEFAULT_PRIORS = { 1: 5, 2: 5, 3: 5, 4: 5 };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Contexto actual del modelo (lo fija el informe y se guarda en disco: ver xpContextStore). */
let currentContext = null;
export const setXpContext = (ctx) => { currentContext = ctx; };
export const getXpContext = () => currentContext;

/** Media de puntos de las últimas `n` jornadas con datos (lastStats/playerStats). */
export const recentForm = (playerMaster, n = 3) => {
  const stats = playerMaster?.lastStats || playerMaster?.playerStats || [];
  const pts = [...stats]
    .filter((s) => isNum(s?.totalPoints))
    .sort((a, b) => (b.weekNumber || 0) - (a.weekNumber || 0))
    .slice(0, n)
    .map((s) => s.totalPoints);
  return pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null;
};

/**
 * @param {object} playerMaster  jugador de la API (playerStats/lastStats, playerStatus…)
 * @param {object|null} trend    entrada de futbolfantasy (playProbability, nextRival, nextIsHome)
 * @param {object|null} [ctx]    { priors, strength, fixtures: Map(teamId → { home, rivalId }) }
 */
export const forecastPoints = (playerMaster, trend = null, ctx = currentContext) => {
  const status = playerMaster?.playerStatus || 'ok';
  const avg = isNum(playerMaster?.averagePoints) ? playerMaster.averagePoints : null;
  const form = recentForm(playerMaster);
  const fixture = ctx?.fixtures?.get(String(playerMaster?.team?.id ?? '')) || null;
  const nextIsHome = fixture ? fixture.home : (trend?.nextIsHome ?? null);
  const common = {
    form, seasonAvg: avg, venueFactor: 1, nextRival: trend?.nextRival || null, nextIsHome,
  };

  // Entrenadores: puntúan por el resultado del equipo → media y forma
  if (playerMaster?.positionId === 5) {
    const base = avg === null ? form : form === null ? avg : 0.6 * avg + 0.4 * form;
    return { ...common, xp: isNum(base) ? Math.max(0, base) : null, playProb: 1, probSource: 'entrenador' };
  }

  const history = buildHistory(playerMaster);
  const blocked = ['injured', 'suspended', 'not_available'].includes(status);
  const ffProb = isNum(trend?.playProbability) ? trend.playProbability : null;
  let pStart = blocked ? 0 : ffProb;
  let probSource = blocked ? 'estado' : ffProb !== null ? 'futbolfantasy' : 'historial';
  if (pStart === null && !history.length) { pStart = FALLBACK_PROB[status] ?? 0.5; probSource = 'estimada'; }

  const rival = fixture
    ? rivalFactor({ positionId: playerMaster?.positionId, rivalId: fixture.rivalId, strength: ctx?.strength, weight: RIVAL_WEIGHT })
    : 1;
  const p = predictV2({
    history,
    positionId: playerMaster?.positionId,
    beforeWeek: Infinity,
    priors: ctx?.priors || DEFAULT_PRIORS,
    pStart,
    status,
    rival,
  });
  // Sin historia ni minutos: la media de la API como respaldo
  const xp = history.length ? p.xp : (isNum(avg) ? Math.max(0, avg) * (pStart ?? 0.5) : null);
  return {
    ...common,
    xp,
    playProb: p.pStart ?? pStart,
    subProb: p.pSub,
    ptsIfStarts: p.ptsStart,
    rivalFactor: rival,
    probSource,
  };
};

// Formaciones DEF-MED-DEL (portero siempre 1). Las premium que usa el usuario: 4-2-4, 4-6-0.
export const FORMATIONS = ['3-4-3', '3-5-2', '4-3-3', '4-4-2', '4-5-1', '5-3-2', '5-4-1', '4-2-4', '4-6-0'];

const parse = (f) => {
  const [d, m, s] = f.split('-').map((x) => parseInt(x, 10));
  return { 1: 1, 2: d, 3: m, 4: s };
};

/**
 * Mejor once para la plantilla dada.
 * @param {Array<{id, name, positionId, xp}>} players
 * @param {{ formations?: string[] }} opts
 * @returns {{ formation, starters, captain, coach, bench, total, ranking }}
 */
export const bestLineup = (players, { formations = FORMATIONS } = {}) => {
  const usable = players.filter((p) => isNum(p.xp));
  const byPos = { 1: [], 2: [], 3: [], 4: [] };
  usable.filter((p) => byPos[p.positionId]).forEach((p) => byPos[p.positionId].push(p));
  Object.values(byPos).forEach((list) => list.sort((a, b) => b.xp - a.xp));
  const coaches = usable.filter((p) => p.positionId === 5).sort((a, b) => b.xp - a.xp);

  const ranking = formations.map((f) => {
    const need = parse(f);
    // Sin suficientes jugadores en una línea: hueco (0 puntos), se permite pero penaliza
    const starters = [1, 2, 3, 4].flatMap((pos) => byPos[pos].slice(0, need[pos]));
    const missing = [1, 2, 3, 4].reduce((s, pos) => s + Math.max(0, need[pos] - byPos[pos].length), 0);
    const captain = [...starters].sort((a, b) => b.xp - a.xp)[0] || null;
    const coach = coaches[0] || null;
    const total = starters.reduce((s, p) => s + p.xp, 0) + (captain ? captain.xp : 0) + (coach ? coach.xp : 0);
    return { formation: f, starters, captain, coach, missing, total };
  }).sort((a, b) => (a.missing - b.missing) || (b.total - a.total));

  const best = ranking[0];
  const startIds = new Set(best.starters.map((p) => p.id));
  const bench = usable.filter((p) => p.positionId !== 5 && !startIds.has(p.id)).sort((a, b) => b.xp - a.xp);
  return { ...best, bench, ranking: ranking.map((r) => ({ formation: r.formation, total: r.total, missing: r.missing })) };
};
