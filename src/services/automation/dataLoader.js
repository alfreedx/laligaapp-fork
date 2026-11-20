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
import { firstKickoff, resolveMatchday } from '../analytics/matchday';
import { buildXpContext } from '../analytics/xpModel';
import { saveXpContext } from './xpContextStore';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Equipos en serie con una pausa corta: evita 429 del API.
const fetchTeams = async (leagueId, standings) => {
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
  return teams;
};

// Inicio real de la jornada = primer partido del calendario (respaldo: openingWeekDate)
const fetchMatchday = async (weekInfo) => {
  const week = weekInfo?.weekNumber ?? null;
  const kickoffOf = async (w) => {
    if (!w) return null;
    try {
      const res = await fantasyAPI.getMatchday(w);
      return firstKickoff(extractArray(res?.data ?? res));
    } catch {
      return null;
    }
  };
  const weekKickoff = await kickoffOf(week);
  const now = new Date();
  const nextKickoff = weekKickoff && new Date(weekKickoff) > now ? null : await kickoffOf(week ? week + 1 : null);
  return resolveMatchday({ week, weekKickoff, nextKickoff, openingWeekDate: weekInfo?.openingWeekDate, now });
};

const initLeague = async ({ leagueId, user }) => {
  const init = await teamService.initialize(leagueId, user);
  if (!init?.success) throw new Error(init?.error || 'No se pudo identificar tu equipo');
  const standings = extractArray(await fantasyAPI.getLeagueRanking(leagueId));
  return { myTeamId: String(init.teamId), standings };
};

/** Versión ligera para el bot: plantillas (con cláusulas), saldo y jornada. */
export const loadClauseData = async ({ leagueId, user }) => {
  const { myTeamId, standings } = await initLeague({ leagueId, user });
  const teams = await fetchTeams(leagueId, standings);
  const [moneyRes, weekRes] = await Promise.all([
    fantasyAPI.getTeamMoney(myTeamId).catch(() => null),
    fantasyAPI.getCurrentWeek().catch(() => null),
  ]);
  return {
    myTeamId,
    myTeam: teams.find((t) => t.teamId === myTeamId) || null,
    myMoney: readTeamMoney(moneyRes) ?? null,
    teams,
    matchday: await fetchMatchday(weekRes?.data || null),
  };
};

export const loadLeagueData = async ({ leagueId, user }) => {
  const { myTeamId, standings } = await initLeague({ leagueId, user });
  const teams = await fetchTeams(leagueId, standings);

  const [activity, marketRes, moneyRes, weekRes, allPlayersRes, lineupRes] = await Promise.all([
    fetchAllActivity(leagueId),
    fantasyAPI.getMarket(leagueId),
    fantasyAPI.getTeamMoney(myTeamId),
    fantasyAPI.getCurrentWeek().catch(() => null),
    fantasyAPI.getAllPlayers().catch(() => null),
    fantasyAPI.getCurrentLineup(myTeamId).catch(() => null),
  ]);

  // Titulares de mi alineación guardada (ids de playerMaster)
  const lineupFormation = (lineupRes?.data || lineupRes)?.formation || {};
  const currentLineupIds = new Set(
    ['goalkeeper', 'defender', 'midfield', 'striker']
      .flatMap((k) => (Array.isArray(lineupFormation[k]) ? lineupFormation[k] : lineupFormation[k] ? [lineupFormation[k]] : []))
      .map((p) => String(p?.playerMaster?.id ?? ''))
      .filter(Boolean)
  );
  // Detalle de la alineación guardada (para el resumen de inicio de jornada)
  const lineupEntries = ['goalkeeper', 'defender', 'midfield', 'striker']
    .flatMap((k) => (Array.isArray(lineupFormation[k]) ? lineupFormation[k] : lineupFormation[k] ? [lineupFormation[k]] : []))
    .filter(Boolean);
  const captainEntry = lineupFormation.captain
    ? lineupEntries.find((p) => String(p?.playerTeamId ?? '') === String(lineupFormation.captain)
      || String(p?.playerMaster?.id ?? '') === String(lineupFormation.captain))
    : null;
  const coachEntry = Array.isArray(lineupFormation.coach) ? lineupFormation.coach[0] : lineupFormation.coach;
  const savedLineup = {
    formation: Array.isArray(lineupFormation.tacticalFormation) ? lineupFormation.tacticalFormation.join('-') : null,
    captainId: captainEntry?.playerMaster?.id != null ? String(captainEntry.playerMaster.id) : null,
    coachId: coachEntry?.playerMaster?.id != null ? String(coachEntry.playerMaster.id) : null,
    benchIds: Object.values(lineupFormation.bench || {})
      .map((p) => (Array.isArray(p) ? p[0] : p)?.playerMaster?.id)
      .filter((id) => id != null).map(String),
  };

  // Todos los jugadores de LaLiga por id (nombres de vendidos, tendencias por id)
  const allPlayersById = new Map();
  extractArray(allPlayersRes).forEach((p) => { if (p?.id) allPlayersById.set(String(p.id), p); });
  teams.forEach((t) => t.players.forEach((p) => {
    if (p.playerMaster?.id) allPlayersById.set(String(p.playerMaster.id), { ...allPlayersById.get(String(p.playerMaster.id)), ...p.playerMaster });
  }));
  const playerNames = new Map([...allPlayersById.entries()].map(([id, p]) => [id, p.nickname || p.name]));

  // Tendencias de futbolfantasy (se refrescan tras el cambio de valores diario)
  let trendsOk = false;
  try {
    const r = await marketTrendsService.refresh();
    trendsOk = !!r?.success || marketTrendsService.marketValuesCache.size > 0;
  } catch {
    trendsOk = marketTrendsService.marketValuesCache.size > 0;
  }
  const resolveTrend = (pm) => (trendsOk && pm ? marketTrendsService.resolveTrendForPlayer(pm) : null);
  const trendById = (id) => resolveTrend(allPlayersById.get(String(id)));

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
  const matchday = await fetchMatchday(weekInfo);
  const market = extractArray(marketRes);

  // Modelo de xP: historial completo de cada jugador (minutos por jornada), calendario con
  // resultados (fuerza de los equipos) y próximo partido de cada equipo
  const calendarByWeek = {};
  for (let w = 1; matchday?.week && w <= matchday.week; w++) {
    try {
      const res = await fantasyAPI.getMatchday(w);
      calendarByWeek[w] = extractArray(res?.data ?? res);
    } catch { /* jornada sin datos */ }
    await sleep(120);
  }
  const masters = [
    ...teams.flatMap((t) => t.players.map((p) => p.playerMaster)),
    ...market.map((m) => m.playerMaster),
  ].filter((pm) => pm?.id);
  for (const pm of masters) {
    if (pm.playerStats?.length) continue;
    try {
      const res = await fantasyAPI.getPlayerDetails(pm.id, leagueId);
      const d = res?.data ?? res;
      const stats = (d?.playerMaster || d)?.playerStats;
      if (Array.isArray(stats)) pm.playerStats = stats;
    } catch { /* se usa lastStats */ }
    await sleep(120);
  }
  const xpContext = buildXpContext({ playerMasters: masters, calendarByWeek, nextWeek: matchday?.week });
  await saveXpContext(xpContext, matchday?.week ?? null); // en memoria y en disco (lo usa también la interfaz)
  const ownerByPlayer = new Map();
  teams.forEach((t) => t.players.forEach((p) => ownerByPlayer.set(String(p.playerMaster?.id), t)));

  return {
    leagueId,
    myTeamId,
    myTeam: teams.find((t) => t.teamId === myTeamId) || null,
    myMoney: readTeamMoney(moneyRes) ?? null,
    teams,
    standings,
    market,
    activity,
    ledger: buildLedger(activity),
    ownerByPlayer,
    myOffers,
    currentLineupIds,
    savedLineup,
    resolveTrend,
    trendById,
    allPlayersById,
    playerNames,
    trendsOk,
    week,
    weekInfo,
    matchday, // { week, kickoff, started } → próximo primer partido
    xpContext,
    loadedAt: new Date().toISOString(),
  };
};

/**
 * Datos para el backtest retroactivo del xP (solo lectura): plantillas, historial
 * completo de cada jugador (detalle del jugador) y calendario con resultados.
 */
export const loadBacktestData = async ({ leagueId, user, onProgress = () => {} }) => {
  const { myTeamId, standings } = await initLeague({ leagueId, user });
  const teams = await fetchTeams(leagueId, standings);
  const weekRes = await fantasyAPI.getCurrentWeek().catch(() => null);
  const weekInfo = weekRes?.data || null;
  const week = weekInfo?.weekNumber ?? null;

  const calendarByWeek = {};
  for (let w = 1; week && w <= week; w++) {
    try {
      const res = await fantasyAPI.getMatchday(w);
      calendarByWeek[w] = extractArray(res?.data ?? res);
    } catch { /* jornada sin datos */ }
    await sleep(150);
  }

  const details = new Map();
  const all = teams.flatMap((t) => t.players.map((p) => p.playerMaster).filter(Boolean));
  for (let i = 0; i < all.length; i++) {
    const pm = all[i];
    try {
      const res = await fantasyAPI.getPlayerDetails(pm.id, leagueId);
      const d = res?.data ?? res;
      details.set(String(pm.id), d?.playerMaster || d);
    } catch { /* sin detalle: se usa lastStats */ }
    onProgress(i + 1, all.length);
    await sleep(150);
  }
  return { myTeamId, teams, calendarByWeek, week, weekInfo, details };
};
