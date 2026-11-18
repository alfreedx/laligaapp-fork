/**
 * Descarga imperativa (sin React) de todo lo que necesita el trabajo diario.
 * Siempre datos frescos: el informe no debe usar cachés de horas antes.
 */
import { fantasyAPI } from '../api';
import teamService from '../teamService';
import marketTrendsService from '../marketTrendsService';
import { extractArray, readTeamMoney } from '../../utils/helpers';
import { extractTeamPlayers } from '../../utils/fetchAllTeamsData';
import { fetchAllActivity } from '../../hooks/useLeagueAnalytics';
import { buildLedger } from '../analytics/ledger';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const loadLeagueData = async ({ leagueId, user }) => {
  const init = await teamService.initialize(leagueId, user);
  if (!init?.success) throw new Error(init?.error || 'No se pudo identificar tu equipo');
  const myTeamId = String(init.teamId);

  const standings = extractArray(await fantasyAPI.getLeagueRanking(leagueId));

  // Equipos en serie con una pausa corta: evita 429 del API.
  const teams = [];
  for (const entry of standings) {
    const teamId = entry.team?.id || entry.id;
    if (!teamId) continue;
    try {
      const res = await fantasyAPI.getTeamData(leagueId, teamId);
      const d = res?.data || res;
      teams.push({
        teamId: String(teamId),
        managerId: String(d?.manager?.id ?? d?.managerId ?? entry.team?.manager?.id ?? ''),
        managerName: d?.manager?.managerName || entry.team?.manager?.managerName || '¿?',
        teamValue: d?.teamValue ?? null,
        teamPoints: d?.teamPoints ?? entry.points ?? null,
        position: entry.position ?? d?.position ?? null,
        players: extractTeamPlayers(res),
      });
    } catch {
      // equipo omitido
    }
    await sleep(250);
  }

  const [activity, marketRes, moneyRes, weekRes] = await Promise.all([
    fetchAllActivity(leagueId),
    fantasyAPI.getMarket(leagueId),
    fantasyAPI.getTeamMoney(myTeamId),
    fantasyAPI.getCurrentWeek().catch(() => null),
  ]);

  // Tendencias de futbolfantasy (se refrescan tras el cambio de valores diario)
  let trendsOk = false;
  try {
    const r = await marketTrendsService.refresh();
    trendsOk = !!r?.success || marketTrendsService.marketValuesCache.size > 0;
  } catch {
    trendsOk = marketTrendsService.marketValuesCache.size > 0;
  }
  const resolveTrend = (pm) => (trendsOk && pm ? marketTrendsService.resolveTrendForPlayer(pm) : null);

  // Ofertas recibidas por mis jugadores en venta (incluye la diaria de LaLiga)
  const myTeamTmp = teams.find((t) => t.teamId === myTeamId);
  const myOffers = new Map();
  for (const pt of myTeamTmp?.players || []) {
    if (!pt.playerMarket?.numberOfOffers) continue;
    try {
      const res = await fantasyAPI.getPlayerOffer(leagueId, pt.playerTeamId);
      const offers = extractArray(res?.data ?? res);
      if (offers.length) myOffers.set(String(pt.playerMaster?.id), offers);
    } catch { /* sin detalle */ }
    await sleep(200);
  }

  const weekInfo = weekRes?.data || null; // { weekNumber, openingWeekDate, closingWeekDate, isLive }
  const week = weekInfo?.weekNumber ?? null;
  const ownerByPlayer = new Map();
  teams.forEach((t) => t.players.forEach((p) => ownerByPlayer.set(String(p.playerMaster?.id), t)));

  return {
    leagueId,
    myTeamId,
    myTeam: teams.find((t) => t.teamId === myTeamId) || null,
    myMoney: readTeamMoney(moneyRes) ?? null,
    teams,
    standings,
    market: extractArray(marketRes),
    activity,
    ledger: buildLedger(activity),
    ownerByPlayer,
    myOffers,
    resolveTrend,
    trendsOk,
    week,
    weekInfo,
    loadedAt: new Date().toISOString(),
  };
};
