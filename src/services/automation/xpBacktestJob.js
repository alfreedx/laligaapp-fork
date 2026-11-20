/**
 * Ejecuta el backtest retroactivo del xP con los datos reales de la liga y
 * guarda el resultado en fantasy-data/xp-backtest.json. Solo lectura.
 */
import { loadBacktestData } from './dataLoader';
import { writeJson } from './localStore';
import { buildHistory } from '../analytics/xpModel';
import { runRetroBacktest } from '../analytics/retroBacktest';

export const XP_BACKTEST_FILE = 'xp-backtest.json';

export const runXpBacktest = async ({ leagueId, user }) => {
  const data = await loadBacktestData({ leagueId, user });
  const players = [];
  data.teams.forEach((t) => t.players.forEach((pt) => {
    const base = pt.playerMaster;
    if (!base?.id || base.positionId === 5) return;
    const full = data.details.get(String(base.id)) || base;
    players.push({
      id: String(base.id),
      name: base.nickname || base.name,
      positionId: base.positionId,
      teamId: String(full?.team?.id ?? base.team?.id ?? ''),
      history: buildHistory({ ...base, ...full }),
    });
  }));
  const squads = data.teams.map((t) => t.players.map((pt) => String(pt.playerMaster?.id)).filter(Boolean));
  // Jornadas ya terminadas, dejando 3 de "calentamiento" para tener historia
  const lastDone = data.week ? data.week - 1 : 0;
  const weeks = [];
  for (let w = 4; w <= lastDone; w++) weeks.push(w);
  const result = runRetroBacktest({ players, calendarByWeek: data.calendarByWeek, squads, weeks });

  const histLens = players.map((p) => p.history.length);
  const coverage = {
    players: players.length,
    withDetail: data.details.size,
    avgHistory: histLens.length ? histLens.reduce((a, b) => a + b, 0) / histLens.length : 0,
    calendarWeeks: Object.keys(data.calendarByWeek).length,
    matchesWithScore: Object.values(data.calendarByWeek).flat().filter((m) => typeof m?.localScore === 'number').length,
    sampleTeamIds: [...new Set(players.slice(0, 5).map((p) => p.teamId))],
    sampleCalendarIds: (data.calendarByWeek[1] || []).slice(0, 3).map((m) => [m.localId ?? m.local?.id, m.visitorId ?? m.visitor?.id]),
  };
  const out = { createdAt: new Date().toISOString(), week: data.week, coverage, ...result };
  await writeJson(XP_BACKTEST_FILE, out);
  return out;
};
