/**
 * Previsión de puntos para la próxima jornada y optimizador de alineación.
 *
 * Modelo (simple y explicable):
 *   base   = 60 % media de la temporada + 40 % forma (media de las últimas 3 jornadas)
 *   xP     = base × factor casa/fuera × probabilidad de jugar
 * Probabilidad de jugar: la de futbolfantasy si existe; si no, según estado
 * (ok 0,6 · duda 0,4 · lesión/sanción 0). Funciones puras.
 */

export const HOME_FACTOR = 1.08;
export const AWAY_FACTOR = 0.93;
const FALLBACK_PROB = { ok: 0.6, doubtful: 0.4, injured: 0, suspended: 0, not_available: 0 };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

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
 * @param {object} playerMaster  jugador de la API (averagePoints, playerStatus, lastStats…)
 * @param {object|null} trend    entrada de futbolfantasy (playProbability, nextRival, nextIsHome)
 */
export const forecastPoints = (playerMaster, trend = null) => {
  const status = playerMaster?.playerStatus || 'ok';
  const avg = isNum(playerMaster?.averagePoints) ? playerMaster.averagePoints : null;
  const form = recentForm(playerMaster);
  const base = avg === null ? form : form === null ? avg : 0.6 * avg + 0.4 * form;

  const isCoach = playerMaster?.positionId === 5;
  let prob;
  let probSource;
  if (isCoach) {
    prob = 1; probSource = 'entrenador';
  } else if (status === 'injured' || status === 'suspended' || status === 'not_available') {
    prob = 0; probSource = 'estado';
  } else if (isNum(trend?.playProbability)) {
    prob = trend.playProbability; probSource = 'futbolfantasy';
  } else {
    prob = FALLBACK_PROB[status] ?? 0.5; probSource = 'estimada';
  }

  const venue = trend?.nextIsHome === true ? HOME_FACTOR : trend?.nextIsHome === false ? AWAY_FACTOR : 1;
  const xp = isNum(base) ? Math.max(0, base) * venue * prob : null;

  return {
    xp,
    playProb: prob,
    probSource,
    form,
    seasonAvg: avg,
    venueFactor: venue,
    nextRival: trend?.nextRival || null,
    nextIsHome: trend?.nextIsHome ?? null,
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
