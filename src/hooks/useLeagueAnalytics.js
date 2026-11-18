import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fantasyAPI } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { extractArray, readTeamMoney } from '../utils/helpers';
import { fetchAllTeamsData, extractTeamPlayers } from '../utils/fetchAllTeamsData';
import useMarketTrends from './useMarketTrends';
import useTeamService from './useTeamService';
import marketTrendsService from '../services/marketTrendsService';
import { buildLedger } from '../services/analytics/ledger';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ACTIVITY_PAGE_DELAY_MS = 350;
const ACTIVITY_MAX_PAGES = 60;

/** Descarga TODO el historial de actividad de la liga (páginas 0..n). */
export const fetchAllActivity = async (leagueId) => {
  let all = [];
  for (let page = 0; page < ACTIVITY_MAX_PAGES; page++) {
    if (page > 0) await sleep(ACTIVITY_PAGE_DELAY_MS);
    const res = await fantasyAPI.getLeagueActivity(leagueId, page);
    const items = extractArray(res);
    if (!items.length) break;
    all = all.concat(items);
  }
  return all;
};

/**
 * Reúne todo lo necesario para los análisis de rentabilidad:
 * plantillas de todos los equipos, actividad completa (→ libro de
 * operaciones), mercado, saldo propio y tendencias de futbolfantasy.
 */
const useLeagueAnalytics = () => {
  const queryClient = useQueryClient();
  const leagueId = useAuthStore((s) => s.leagueId);
  const user = useAuthStore((s) => s.user);
  const { data: teamInit } = useTeamService(leagueId, user);
  const myTeamId = teamInit?.teamId ? String(teamInit.teamId) : null;
  const { trendsReady } = useMarketTrends();

  const standingsQ = useQuery({
    queryKey: ['standings', leagueId],
    queryFn: () => fantasyAPI.getLeagueRanking(leagueId),
    enabled: !!leagueId,
    staleTime: 10 * 60 * 1000,
  });

  const teamsQ = useQuery({
    queryKey: ['analyticsTeams', leagueId],
    queryFn: async () => {
      const map = await fetchAllTeamsData(queryClient, leagueId, standingsQ.data, { staleTime: 5 * 60 * 1000 });
      return [...map.entries()].map(([teamId, { teamData, entry }]) => {
        const d = teamData?.data || teamData;
        return {
          teamId: String(teamId),
          managerId: String(d?.manager?.id ?? d?.managerId ?? entry?.team?.manager?.id ?? ''),
          managerName: d?.manager?.managerName || entry?.team?.manager?.managerName || entry?.name || '¿?',
          teamValue: d?.teamValue ?? null,
          teamPoints: d?.teamPoints ?? entry?.points ?? null,
          position: d?.position ?? entry?.position ?? null,
          players: extractTeamPlayers(teamData),
        };
      });
    },
    enabled: !!leagueId && !!standingsQ.data,
    staleTime: 5 * 60 * 1000,
  });

  const activityQ = useQuery({
    queryKey: ['activityAll', leagueId],
    queryFn: () => fetchAllActivity(leagueId),
    enabled: !!leagueId,
    staleTime: 15 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  const marketQ = useQuery({
    queryKey: ['market', leagueId],
    queryFn: () => fantasyAPI.getMarket(leagueId),
    enabled: !!leagueId,
    staleTime: 60 * 1000,
  });

  const moneyQ = useQuery({
    queryKey: ['teamMoney', myTeamId],
    queryFn: () => fantasyAPI.getTeamMoney(myTeamId),
    enabled: !!myTeamId,
    staleTime: 60 * 1000,
  });

  const allPlayersQ = useQuery({
    queryKey: ['allPlayers'],
    queryFn: () => fantasyAPI.getAllPlayers(),
    staleTime: 5 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  // id → jugador / nombre visible (ventas de jugadores que ya no están en plantillas, tendencias por id)
  const allPlayersById = useMemo(() => {
    const m = new Map();
    extractArray(allPlayersQ.data).forEach((p) => { if (p?.id) m.set(String(p.id), p); });
    return m;
  }, [allPlayersQ.data]);
  const playerNames = useMemo(
    () => new Map([...allPlayersById.entries()].map(([id, p]) => [id, p.nickname || p.name])),
    [allPlayersById]
  );

  const ledger = useMemo(
    () => (activityQ.data ? buildLedger(activityQ.data) : null),
    [activityQ.data]
  );

  const teams = useMemo(() => teamsQ.data || [], [teamsQ.data]);
  const market = useMemo(() => extractArray(marketQ.data), [marketQ.data]);
  const myTeam = teams.find((t) => t.teamId === myTeamId) || null;
  const myMoney = moneyQ.data ? readTeamMoney(moneyQ.data) : null;

  // Mapa playerMasterId → dueño (para saber si un jugador del mercado es de un rival)
  const ownerByPlayer = useMemo(() => {
    const m = new Map();
    teams.forEach((t) => t.players.forEach((p) => m.set(String(p.playerMaster?.id), t)));
    return m;
  }, [teams]);

  const resolveTrend = useCallback((playerMaster, teamName) => {
    if (!trendsReady || !playerMaster) return null;
    return marketTrendsService.resolveTrendForPlayer({
      ...playerMaster,
      team: playerMaster.team || (teamName ? { name: teamName } : undefined),
    });
  }, [trendsReady]);

  const trendById = useCallback((id) => {
    const key = String(id);
    const pm = allPlayersById.get(key) || ownerByPlayer.get(key)?.players.find((p) => String(p.playerMaster?.id) === key)?.playerMaster;
    return resolveTrend(pm);
  }, [allPlayersById, ownerByPlayer, resolveTrend]);

  const isLoading = standingsQ.isLoading || teamsQ.isLoading || activityQ.isLoading || marketQ.isLoading;
  const error = standingsQ.error || teamsQ.error || activityQ.error || marketQ.error || null;

  const refetchAll = () => Promise.all([
    standingsQ.refetch(), teamsQ.refetch(), activityQ.refetch(), marketQ.refetch(), moneyQ.refetch(),
  ]);

  return {
    leagueId,
    myTeamId,
    myTeam,
    myMoney,
    teams,
    market,
    activity: activityQ.data || [],
    ledger,
    ownerByPlayer,
    playerNames,
    resolveTrend,
    trendById,
    trendsReady,
    isLoading,
    loadingActivity: activityQ.isFetching,
    error,
    refetchAll,
  };
};

export default useLeagueAnalytics;
