import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from '../../utils/motionShim';
import {
  Target, Save, RotateCcw, Users, ChevronDown, Check,
  AlertCircle, User, X, Search, Grid3x3, Loader, Sparkles
} from 'lucide-react';
import { fantasyAPI } from '../../services/api';
import useMarketTrends from '../../hooks/useMarketTrends';
import marketTrendsService from '../../services/marketTrendsService';
import { forecastPoints, bestLineup, FORMATIONS } from '../../services/analytics/forecast';
import { ensureXpContextLoaded } from '../../services/automation/xpContextStore';
import { useAuthStore } from '../../stores/authStore';
import LoadingSpinner from '../Common/LoadingSpinner';
import toast from 'react-hot-toast';

// Banquillo premium: un suplente por línea
const EMPTY_BENCH = { goalkeeper: null, defender: null, midfield: null, striker: null };
const BENCH_LINES = [['goalkeeper', 1, 'Portero'], ['defender', 2, 'Defensa'], ['midfield', 3, 'Medio'], ['striker', 4, 'Delantero']];
const ptId = (p) => (p ? String(p.playerTeamId || p.id) : null);
const pName = (p) => p?.playerMaster?.nickname || p?.playerMaster?.name || '—';

const LineupEditor = () => {
  const leagueId = useAuthStore((state) => state.leagueId);
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();

  // State
  const [selectedFormation, setSelectedFormation] = useState(null);
  const [originalFormation, setOriginalFormation] = useState(null);
  const [lineup, setLineup] = useState({
    goalkeeper: null,
    defender: [],
    midfield: [],
    striker: []
  });
  const [originalLineup, setOriginalLineup] = useState(null);
  const [isFormationDropdownOpen, setIsFormationDropdownOpen] = useState(false);
  const [selectedPosition, setSelectedPosition] = useState(null); // { type: 'goalkeeper'|'defender'|'midfield'|'striker', index: number }
  const [searchTerm, setSearchTerm] = useState('');
  const [saving, setSaving] = useState(false);

  // Premium: capitán (playerTeamId), entrenador y banquillo (un suplente por línea)
  const [captainId, setCaptainId] = useState(null);
  const [coach, setCoach] = useState(null);
  const [bench, setBench] = useState(EMPTY_BENCH);
  const [originalExtras, setOriginalExtras] = useState(null);
  const [hasPremiumSlots, setHasPremiumSlots] = useState(false);

  // Get user's team ID
  const { data: standings } = useQuery({
    queryKey: ['standings', leagueId],
    queryFn: () => fantasyAPI.getLeagueRanking(leagueId),
    enabled: !!leagueId,
  });

  const userTeamId = React.useMemo(() => {
    if (!standings || !user) return null;
    const teamsArray = Array.isArray(standings) ? standings :
                       standings?.data || standings?.elements || [];
    const userTeam = teamsArray.find(team => {
      const teamUserId = team.userId || team.team?.userId || team.team?.manager?.id;
      return teamUserId && user?.userId && teamUserId.toString() === user.userId.toString();
    });
    return userTeam?.id || userTeam?.team?.id;
  }, [standings, user]);

  // Fetch current lineup
  const { data: currentLineupData, isLoading: loadingLineup } = useQuery({
    queryKey: ['currentLineup', userTeamId],
    queryFn: () => fantasyAPI.getCurrentLineup(userTeamId),
    enabled: !!userTeamId,
    staleTime: 0,
  });

  // Fetch formations
  const { data: freeFormations } = useQuery({
    queryKey: ['freeFormations'],
    queryFn: () => fantasyAPI.getFreeFormations(),
    staleTime: 60 * 60 * 1000, // 1 hour
  });

  const { data: premiumFormations } = useQuery({
    queryKey: ['premiumFormations'],
    queryFn: () => fantasyAPI.getPremiumFormations(),
    staleTime: 60 * 60 * 1000,
  });

  const { data: premiumConfig } = useQuery({
    queryKey: ['premiumConfig'],
    queryFn: () => fantasyAPI.getPremiumConfiguration(),
    staleTime: 60 * 60 * 1000,
  });

  // Fetch team players
  const { data: teamData } = useQuery({
    queryKey: ['teamData', leagueId, userTeamId],
    queryFn: () => fantasyAPI.getTeamData(leagueId, userTeamId),
    enabled: !!leagueId && !!userTeamId,
  });

  // Extract team players
  const teamPlayers = React.useMemo(() => {
    if (!teamData) return [];
    const data = teamData?.data || teamData;
    return data?.players || [];
  }, [teamData]);

  // Parse formations
  const allFormations = React.useMemo(() => {
    const free = Array.isArray(freeFormations) ? freeFormations :
                 freeFormations?.data || freeFormations?.elements || [];
    const premium = Array.isArray(premiumFormations) ? premiumFormations :
                    premiumFormations?.data || premiumFormations?.elements || [];

    return [
      ...free.map(f => ({ formation: f, isPremium: false })),
      ...premium.map(f => ({ formation: f, isPremium: true }))
    ];
  }, [freeFormations, premiumFormations]);

  // Check if formations feature is enabled
  const formationsEnabled = React.useMemo(() => {
    const config = premiumConfig?.data || premiumConfig || [];
    const formationsFeature = config.find(item => item.key === 'formations');
    return formationsFeature?.value === true;
  }, [premiumConfig]);

  // Initialize lineup from current data
  useEffect(() => {
    if (!currentLineupData) return;

    const data = currentLineupData?.data || currentLineupData;
    const formation = data?.formation;

    if (formation) {
      const newLineup = {
        goalkeeper: formation.goalkeeper?.[0] || null,
        defender: formation.defender || [],
        midfield: formation.midfield || [],
        striker: formation.striker || []
      };

      setLineup(newLineup);
      setOriginalLineup(JSON.parse(JSON.stringify(newLineup)));

      // Extras premium tal como los devuelve la API (coach: [player], captain: "id", bench: {linea: player})
      const premium = 'coach' in formation || 'bench' in formation || 'captain' in formation;
      setHasPremiumSlots(premium);
      const loadedCoach = Array.isArray(formation.coach) ? formation.coach[0] || null : formation.coach || null;
      const loadedBench = { ...EMPTY_BENCH };
      Object.entries(formation.bench || {}).forEach(([line, p]) => {
        if (line in loadedBench) loadedBench[line] = Array.isArray(p) ? p[0] || null : p || null;
      });
      const loadedCaptain = formation.captain ? String(formation.captain) : null;
      setCoach(loadedCoach);
      setBench(loadedBench);
      setCaptainId(loadedCaptain);
      setOriginalExtras({ coach: loadedCoach, bench: loadedBench, captainId: loadedCaptain });

      // Set formation
      const tacticalFormation = formation.tacticalFormation;
      if (Array.isArray(tacticalFormation)) {
        const formationStr = tacticalFormation.join(',');
        setSelectedFormation(formationStr);
        setOriginalFormation(formationStr);
      }
    }
  }, [currentLineupData]);

  // Parse formation string to get requirements
  const getFormationRequirements = useCallback((formationStr) => {
    if (!formationStr) return null;
    const parts = formationStr.split(',').map(Number);
    if (parts.length !== 3) return null;

    return {
      defenders: parts[0],
      midfielders: parts[1],
      strikers: parts[2],
      total: parts[0] + parts[1] + parts[2] + 1 // +1 for goalkeeper
    };
  }, []);

  const formationReq = getFormationRequirements(selectedFormation);

  // Handle formation change
  const handleFormationChange = (newFormation) => {
    setSelectedFormation(newFormation);
    setIsFormationDropdownOpen(false);

    const req = getFormationRequirements(newFormation);
    if (!req) return;

    // Adjust lineup to match new formation
    setLineup(prev => ({
      goalkeeper: prev.goalkeeper,
      defender: prev.defender.slice(0, req.defenders),
      midfield: prev.midfield.slice(0, req.midfielders),
      striker: prev.striker.slice(0, req.strikers)
    }));
  };

  // Handle player selection
  const handlePlayerSelect = (player, position) => {
    const playerTeamId = player.playerTeamId || player.id;

    // Check if player is already in lineup
    const isInLineup =
      lineup.goalkeeper?.playerTeamId === playerTeamId ||
      lineup.defender.some(p => p?.playerTeamId === playerTeamId) ||
      lineup.midfield.some(p => p?.playerTeamId === playerTeamId) ||
      lineup.striker.some(p => p?.playerTeamId === playerTeamId);

    if (isInLineup) {
      toast.error('Este jugador ya está en la alineación');
      return;
    }

    setLineup(prev => {
      const newLineup = { ...prev };

      if (position === 'goalkeeper') {
        newLineup.goalkeeper = player;
      } else if (position === 'defender' && selectedPosition?.index !== undefined) {
        newLineup.defender = [...prev.defender];
        newLineup.defender[selectedPosition.index] = player;
      } else if (position === 'midfield' && selectedPosition?.index !== undefined) {
        newLineup.midfield = [...prev.midfield];
        newLineup.midfield[selectedPosition.index] = player;
      } else if (position === 'striker' && selectedPosition?.index !== undefined) {
        newLineup.striker = [...prev.striker];
        newLineup.striker[selectedPosition.index] = player;
      }

      return newLineup;
    });

    setSelectedPosition(null);
  };

  // Remove player from lineup
  const handlePlayerRemove = (position, index = null) => {
    setLineup(prev => {
      const newLineup = { ...prev };

      if (position === 'goalkeeper') {
        newLineup.goalkeeper = null;
      } else if (position === 'defender' && index !== null) {
        newLineup.defender = [...prev.defender];
        newLineup.defender[index] = null;
      } else if (position === 'midfield' && index !== null) {
        newLineup.midfield = [...prev.midfield];
        newLineup.midfield[index] = null;
      } else if (position === 'striker' && index !== null) {
        newLineup.striker = [...prev.striker];
        newLineup.striker[index] = null;
      }

      return newLineup;
    });
  };

  // Save lineup
  const handleSave = async () => {
    if (!selectedFormation || !userTeamId) {
      toast.error('Selecciona una formación válida');
      return;
    }

    setSaving(true);

    try {
      const formationArray = selectedFormation.split(',').map(Number);

      const lineupData = {
        goalkeeper: lineup.goalkeeper ? (lineup.goalkeeper.playerTeamId || lineup.goalkeeper.id) : null,
        defender: lineup.defender.filter(p => p).map(p => p.playerTeamId || p.id),
        midfield: lineup.midfield.filter(p => p).map(p => p.playerTeamId || p.id),
        striker: lineup.striker.filter(p => p).map(p => p.playerTeamId || p.id),
        tactical_formation: formationArray
      };

      // Premium: mismo convenio que los titulares en el PUT (un id por puesto, snake_case).
      // Formato no documentado → tras guardar se verifica leyendo la alineación de nuevo.
      if (hasPremiumSlots) {
        if (coach) lineupData.coach = ptId(coach);
        if (captainId) lineupData.captain = String(captainId);
        lineupData.bench = Object.fromEntries(
          Object.entries(bench).filter(([, p]) => p).map(([line, p]) => [line, ptId(p)])
        );
      }

      await fantasyAPI.updateLineup(userTeamId, lineupData);

      // Verificación: ¿LaLiga ha guardado de verdad cada campo?
      const problems = [];
      try {
        const fresh = await fantasyAPI.getCurrentLineup(userTeamId);
        const f = (fresh?.data || fresh)?.formation || {};
        const ids = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(ptId).sort().join(',');
        const sent = (arr) => arr.map(String).sort().join(',');
        if (ids(f.goalkeeper) !== sent(lineupData.goalkeeper ? [lineupData.goalkeeper] : [])) problems.push('portero');
        if (ids(f.defender) !== sent(lineupData.defender)) problems.push('defensas');
        if (ids(f.midfield) !== sent(lineupData.midfield)) problems.push('medios');
        if (ids(f.striker) !== sent(lineupData.striker)) problems.push('delanteros');
        if (hasPremiumSlots) {
          if (lineupData.coach && ids(f.coach) !== String(lineupData.coach)) problems.push('entrenador');
          if (lineupData.captain && String(f.captain || '') !== lineupData.captain) problems.push('capitán');
          Object.entries(lineupData.bench || {}).forEach(([line, id]) => {
            if (ids(f.bench?.[line]) !== String(id)) problems.push(`banquillo (${line})`);
          });
        }
      } catch (_e) {
        problems.push('no se pudo comprobar');
      }

      if (problems.length) {
        toast.error(`Guardado, pero LaLiga no ha aplicado: ${problems.join(', ')}. Revísalo en la app oficial y dímelo para ajustar el formato.`, { duration: 15000 });
      } else {
        toast.success('¡Alineación guardada y verificada (titulares, capitán, entrenador y banquillo)!', { duration: 6000 });
      }

      // Update cache
      queryClient.invalidateQueries({ queryKey: ['currentLineup', userTeamId] });
      queryClient.invalidateQueries({ queryKey: ['teamData', leagueId, userTeamId] });

      // Update original lineup and formation
      setOriginalLineup(JSON.parse(JSON.stringify(lineup)));
      setOriginalFormation(selectedFormation);
      setOriginalExtras({ coach, bench, captainId });
    } catch (error) {
      toast.error(error.message || 'Error al guardar la alineación');
    } finally {
      setSaving(false);
    }
  };

  // Alineación recomendada (previsión de puntos de la app). Solo rellena el
  // editor: el usuario revisa y pulsa Guardar.
  const { trendsReady } = useMarketTrends();
  const [recommendation, setRecommendation] = useState(null);
  // Mismo modelo de xP que el informe (rival, medias por posición)
  useEffect(() => { ensureXpContextLoaded().catch(() => null); }, []);

  const handleLoadRecommended = () => {
    if (!teamPlayers.length) {
      toast.error('No se ha cargado tu plantilla');
      return;
    }
    const rows = teamPlayers
      .filter((pt) => pt.playerMaster)
      .map((pt) => {
        const pm = pt.playerMaster;
        const trend = trendsReady ? marketTrendsService.resolveTrendForPlayer(pm) : null;
        return { id: String(pt.playerTeamId || pt.id), name: pm.nickname || pm.name, positionId: pm.positionId, pt, ...forecastPoints(pm, trend) };
      });
    // Solo formaciones disponibles en tu cuenta (si la API las da); si no, las estándar + premium del usuario
    const available = allFormations
      .filter(({ isPremium }) => !isPremium || formationsEnabled)
      .map(({ formation }) => String(formation).replace(/,/g, '-'));
    const best = bestLineup(rows, { formations: available.length ? available : FORMATIONS });
    if (best.missing > 0) {
      toast.error('No tienes jugadores suficientes para ninguna formación');
      return;
    }
    const byPos = (posId) => best.starters.filter((p) => p.positionId === posId).sort((a, b) => b.xp - a.xp).map((p) => p.pt);
    setSelectedFormation(best.formation.replace(/-/g, ','));
    setLineup({
      goalkeeper: byPos(1)[0] || null,
      defender: byPos(2),
      midfield: byPos(3),
      striker: byPos(4),
    });
    // Capitán, entrenador y banquillo (mejor suplente por línea según xP)
    setCaptainId(best.captain ? String(best.captain.id) : null);
    if (best.coach) setCoach(best.coach.pt);
    const nextBench = { ...EMPTY_BENCH };
    BENCH_LINES.forEach(([line, posId]) => {
      const sub = best.bench.find((p) => p.positionId === posId);
      nextBench[line] = sub ? sub.pt : null;
    });
    setBench(nextBench);
    setRecommendation({
      formation: best.formation,
      total: best.total,
      captain: best.captain?.name || null,
      coach: best.coach?.name || null,
      doubtful: best.starters.filter((p) => p.playProb < 0.6).map((p) => `${p.name} (${Math.round(p.playProb * 100)} %)`),
      trendsReady,
    });
    toast.success(`Alineación recomendada cargada (${best.formation}). Revísala y pulsa Guardar.`);
  };

  // Reset to original
  const handleReset = () => {
    if (originalLineup) {
      setLineup(JSON.parse(JSON.stringify(originalLineup)));
      if (originalFormation) {
        setSelectedFormation(originalFormation);
      }
      if (originalExtras) {
        setCoach(originalExtras.coach);
        setBench(originalExtras.bench);
        setCaptainId(originalExtras.captainId);
      }
      toast.success('Cambios revertidos');
    }
  };

  // Check if there are changes
  const hasChanges = React.useMemo(() => {
    if (!originalLineup) return false;
    const lineupChanged = JSON.stringify(lineup) !== JSON.stringify(originalLineup);
    const formationChanged = selectedFormation !== originalFormation;
    const extrasChanged = !!originalExtras && (
      ptId(coach) !== ptId(originalExtras.coach) ||
      captainId !== originalExtras.captainId ||
      Object.keys(EMPTY_BENCH).some((k) => ptId(bench[k]) !== ptId(originalExtras.bench[k]))
    );
    return lineupChanged || formationChanged || extrasChanged;
  }, [lineup, originalLineup, selectedFormation, originalFormation, coach, captainId, bench, originalExtras]);

  // Titulares actuales (para elegir capitán) y jugadores fuera del once (banquillo)
  const starters = React.useMemo(
    () => [lineup.goalkeeper, ...lineup.defender, ...lineup.midfield, ...lineup.striker].filter(Boolean),
    [lineup]
  );
  const starterIds = React.useMemo(() => new Set(starters.map(ptId)), [starters]);
  const coaches = React.useMemo(() => teamPlayers.filter((pt) => pt.playerMaster?.positionId === 5), [teamPlayers]);

  // Coherencia: el capitán debe ser titular; un titular no puede estar en el banquillo
  useEffect(() => {
    if (captainId && !starterIds.has(String(captainId))) setCaptainId(null);
    setBench((prev) => {
      let changed = false;
      const next = { ...prev };
      Object.keys(next).forEach((k) => {
        if (next[k] && starterIds.has(ptId(next[k]))) { next[k] = null; changed = true; }
      });
      return changed ? next : prev;
    });
  }, [starterIds, captainId]);

  // Filter players by position and search
  const getAvailablePlayersByPosition = (positionId) => {
    return teamPlayers.filter(playerTeam => {
      const player = playerTeam.playerMaster;
      if (!player) return false;

      // Check position
      if (player.positionId !== positionId) return false;

      // Check if already in lineup (only check non-null positions)
      const playerTeamId = playerTeam.playerTeamId || playerTeam.id;
      const isInLineup =
        (lineup.goalkeeper && (lineup.goalkeeper.playerTeamId === playerTeamId || lineup.goalkeeper.id === playerTeamId)) ||
        lineup.defender.some(p => p && (p.playerTeamId === playerTeamId || p.id === playerTeamId)) ||
        lineup.midfield.some(p => p && (p.playerTeamId === playerTeamId || p.id === playerTeamId)) ||
        lineup.striker.some(p => p && (p.playerTeamId === playerTeamId || p.id === playerTeamId));

      if (isInLineup) return false;

      // Check search term
      if (searchTerm) {
        const name = (player.nickname || player.name || '').toLowerCase();
        return name.includes(searchTerm.toLowerCase());
      }

      return true;
    });
  };

  if (loadingLineup) {
    return <LoadingSpinner fullScreen />;
  }

  if (!userTeamId) {
    return (
      <div className="max-w-7xl mx-auto p-6">
        <div className="card p-12 text-center">
          <AlertCircle className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            No se encontró tu equipo
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            Debes estar registrado en una liga para editar tu alineación
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="card p-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary-100 dark:bg-primary-900/30 rounded-xl">
              <Grid3x3 className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Editor de Alineación
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Configura tu formación y selecciona tus jugadores
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleLoadRecommended}
              disabled={saving || !teamPlayers.length}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Rellena el editor con el once de más puntos esperados (no guarda hasta que pulses Guardar)"
            >
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>Cargar recomendada</span>
            </button>
            <button
              onClick={handleReset}
              disabled={!hasChanges || saving}
              className="btn-secondary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-4 h-4" />
              <span className="hidden sm:inline">Revertir</span>
            </button>
            <button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Guardar
                </>
              )}
            </button>
          </div>
        </div>
        {recommendation && (
          <div className="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-sm text-gray-700 dark:text-gray-200 space-y-1">
            <div>
              <Sparkles className="inline w-4 h-4 text-amber-500 mr-1" />
              Recomendada: <b>{recommendation.formation}</b> · previsión <b>{recommendation.total.toFixed(1).replace('.', ',')} pts</b> (con capitán ×2 y entrenador).
              {hasChanges ? ' Pulsa Guardar para aplicarla.' : ''}
            </div>
            <div>
              Capitán: <b>{recommendation.captain || '—'}</b> · Entrenador: <b>{recommendation.coach || '—'}</b> · Banquillo: el mejor suplente de cada línea (puedes cambiarlos abajo).
            </div>
            {recommendation.doubtful.length > 0 && (
              <div className="text-amber-700 dark:text-amber-400">⚠️ Titulares con probabilidad &lt; 60 %: {recommendation.doubtful.join(', ')} — revisa los onces probables antes del cierre.</div>
            )}
            {!recommendation.trendsReady && (
              <div className="text-gray-500">Sin datos de futbolfantasy todavía: la previsión usa solo medias y forma.</div>
            )}
          </div>
        )}
      </div>

      {/* Formation Selector - Improved Design */}
      <div className="card p-6">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary-100 dark:bg-primary-900/30 rounded-xl">
              <Target className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Formación Táctica
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Selecciona tu esquema
              </p>
            </div>
          </div>

          <div className="flex-1 lg:max-w-md">
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsFormationDropdownOpen(!isFormationDropdownOpen)}
                className="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white hover:border-primary-400 dark:hover:border-primary-500 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-all font-semibold flex items-center justify-between group"
              >
                <span className="flex items-center gap-3">
                  <div className="px-3 h-12 bg-gradient-to-br from-primary-500 to-primary-600 rounded-lg flex items-center justify-center text-white font-bold shadow-sm text-base whitespace-nowrap">
                    {selectedFormation ? selectedFormation.split(',').join('-') : '?'}
                  </div>
                  <div className="text-left">
                    <div className="text-sm font-semibold">
                      {selectedFormation ? selectedFormation.split(',').join(' - ') : 'Selecciona una formación'}
                    </div>
                    {selectedFormation && (
                      <div className="text-xs text-gray-500 dark:text-gray-400 font-normal">
                        {selectedFormation.split(',')[0]} Def · {selectedFormation.split(',')[1]} Med · {selectedFormation.split(',')[2]} Del
                      </div>
                    )}
                  </div>
                </span>
                <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform ${isFormationDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* Improved Dropdown */}
              <AnimatePresence>
                {isFormationDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl z-50 max-h-80 overflow-y-auto"
                  >
                    <div className="p-2">
                      {allFormations.map(({ formation, isPremium }) => {
                        const isSelected = selectedFormation === formation;
                        const parts = formation.split(',');
                        const formationDisplay = parts.join(' - ');

                        return (
                          <button
                            key={formation}
                            type="button"
                            onClick={() => handleFormationChange(formation)}
                            disabled={isPremium && !formationsEnabled}
                            className={`w-full px-4 py-3 rounded-lg text-sm flex items-center gap-3 transition-all mb-1 ${
                              isSelected
                                ? 'bg-gradient-to-r from-primary-500 to-primary-600 text-white shadow-md'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-700/70 text-gray-900 dark:text-white'
                            } ${isPremium && !formationsEnabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                          >
                            <div className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-base ${
                              isSelected
                                ? 'bg-white/20 text-white'
                                : 'bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-600 text-gray-700 dark:text-gray-200'
                            }`}>
                              {parts.join('-')}
                            </div>
                            <div className="flex-1 text-left">
                              <div className={`font-semibold ${isSelected ? 'text-white' : 'text-gray-900 dark:text-white'}`}>
                                {formationDisplay}
                              </div>
                              <div className={`text-xs ${isSelected ? 'text-white/80' : 'text-gray-500 dark:text-gray-400'}`}>
                                {parts[0]} Def · {parts[1]} Med · {parts[2]} Del
                              </div>
                            </div>
                            {isPremium && (
                              <span className={`text-lg ${isSelected ? 'opacity-90' : ''}`}>
                                ⭐{!formationsEnabled && '🔒'}
                              </span>
                            )}
                            {isSelected && (
                              <Check className="w-5 h-5 flex-shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Backdrop */}
              {isFormationDropdownOpen && (
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setIsFormationDropdownOpen(false)}
                />
              )}
            </div>
          </div>

          {/* Formation info - Visual badges */}
          {formationReq && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="px-3 py-2 bg-yellow-100 dark:bg-yellow-900/30 rounded-lg border border-yellow-200 dark:border-yellow-800">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-yellow-700 dark:text-yellow-400 font-medium">Porteros</span>
                  <span className="font-bold text-yellow-800 dark:text-yellow-300">1</span>
                </div>
              </div>
              <div className="px-3 py-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-blue-700 dark:text-blue-400 font-medium">Defensas</span>
                  <span className="font-bold text-blue-800 dark:text-blue-300">{formationReq.defenders}</span>
                </div>
              </div>
              <div className="px-3 py-2 bg-green-100 dark:bg-green-900/30 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-green-700 dark:text-green-400 font-medium">Centrocampistas</span>
                  <span className="font-bold text-green-800 dark:text-green-300">{formationReq.midfielders}</span>
                </div>
              </div>
              <div className="px-3 py-2 bg-red-100 dark:bg-red-900/30 rounded-lg border border-red-200 dark:border-red-800">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-700 dark:text-red-400 font-medium">Delanteros</span>
                  <span className="font-bold text-red-800 dark:text-red-300">{formationReq.strikers}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Capitán, entrenador y banquillo (premium) */}
      {hasPremiumSlots && (
        <div className="card p-4 space-y-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Capitán, entrenador y banquillo</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="font-medium">© Capitán (puntos ×2)</span>
              <select className="input-field !py-1.5" value={captainId || ''} onChange={(e) => setCaptainId(e.target.value || null)}>
                <option value="">— Sin capitán —</option>
                {starters.map((p) => <option key={ptId(p)} value={ptId(p)}>{pName(p)}</option>)}
              </select>
              {!captainId && <span className="text-xs text-amber-600">⚠️ Sin capitán pierdes el ×2.</span>}
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">🧑‍💼 Entrenador</span>
              <select
                className="input-field !py-1.5"
                value={ptId(coach) || ''}
                onChange={(e) => setCoach(coaches.find((c) => ptId(c) === e.target.value) || null)}
              >
                <option value="">— Sin entrenador —</option>
                {coaches.map((c) => <option key={ptId(c)} value={ptId(c)}>{pName(c)}</option>)}
              </select>
            </label>
            {BENCH_LINES.map(([line, posId, label]) => {
              const options = teamPlayers.filter((pt) => pt.playerMaster?.positionId === posId && !starterIds.has(ptId(pt)));
              return (
                <label key={line} className="flex flex-col gap-1">
                  <span className="font-medium">🪑 Banquillo — {label}</span>
                  <select
                    className="input-field !py-1.5"
                    value={ptId(bench[line]) || ''}
                    onChange={(e) => setBench((b) => ({ ...b, [line]: options.find((o) => ptId(o) === e.target.value) || null }))}
                  >
                    <option value="">— Vacío —</option>
                    {options.map((o) => <option key={ptId(o)} value={ptId(o)}>{pName(o)}</option>)}
                  </select>
                </label>
              );
            })}
          </div>
          <p className="text-xs text-gray-500">
            Se guardan junto con la alineación al pulsar <b>Guardar</b>. Después la app comprueba en LaLiga que se ha aplicado todo y te avisa si algo no se guardó.
          </p>
        </div>
      )}

      {/* Field Visualization */}
      {formationReq && (
        <div className="card p-4 sm:p-6">
          <div className="mb-3 sm:mb-4">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
              Alineación Actual
            </h2>
            <p className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 mt-1">
              Click en las posiciones para seleccionar o cambiar jugadores
            </p>
          </div>

          {/* Football Field */}
          <div className="relative bg-gradient-to-b from-green-600 to-green-700 rounded-xl p-3 sm:p-8 min-h-[320px] sm:min-h-[500px]">
            {/* Field markings */}
            <div className="absolute inset-4 border-2 border-white/30 rounded-lg">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-20 sm:w-32 h-12 sm:h-16 border-2 border-white/30 border-t-0 rounded-b-lg" />
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-20 sm:w-32 h-12 sm:h-16 border-2 border-white/30 border-b-0 rounded-t-lg" />
              <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-white/30" />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 sm:w-20 sm:h-20 border-2 border-white/30 rounded-full" />
            </div>

            {/* Players */}
            <div className="relative h-full flex flex-col pt-3 sm:pt-6 pb-8 sm:pb-3">
              {/* Strikers - Muy adelantados */}
              <div className="mb-5 sm:mb-10">
                <PositionRow
                  players={lineup.striker}
                  count={formationReq.strikers}
                  label="Delanteros"
                  positionKey="striker"
                  positionType="striker"
                  selectedPosition={selectedPosition}
                  onSlotClick={(index) => {
                    setSelectedPosition({ type: 'striker', index });
                  }}
                  onPlayerRemove={(index) => handlePlayerRemove('striker', index)}
                />
              </div>

              {/* Midfielders - En el centro del campo */}
              <div className="flex-1 flex items-center justify-center">
                <PositionRow
                  players={lineup.midfield}
                  count={formationReq.midfielders}
                  label="Centrocampistas"
                  positionKey="midfield"
                  positionType="midfield"
                  selectedPosition={selectedPosition}
                  onSlotClick={(index) => {
                    setSelectedPosition({ type: 'midfield', index });
                  }}
                  onPlayerRemove={(index) => handlePlayerRemove('midfield', index)}
                />
              </div>

              {/* Defenders - Más atrás */}
              <div className="mt-5 sm:mt-10 mb-4 sm:mb-8">
                <PositionRow
                  players={lineup.defender}
                  count={formationReq.defenders}
                  label="Defensas"
                  positionKey="defender"
                  positionType="defender"
                  selectedPosition={selectedPosition}
                  onSlotClick={(index) => {
                    setSelectedPosition({ type: 'defender', index });
                  }}
                  onPlayerRemove={(index) => handlePlayerRemove('defender', index)}
                />
              </div>

              {/* Goalkeeper - Pegado a la portería */}
              <div className="flex justify-center">
                <PlayerSlot
                  player={lineup.goalkeeper}
                  onClick={() => setSelectedPosition({ type: 'goalkeeper', index: 0 })}
                  onRemove={() => handlePlayerRemove('goalkeeper')}
                  isSelected={selectedPosition?.type === 'goalkeeper'}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Available Players Section */}
      <div className="card p-6">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Users className="w-5 h-5" />
            Plantilla Disponible
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {teamPlayers.length} jugadores en total
          </p>
        </div>

        {/* Players by Position */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Goalkeepers */}
          <PositionPlayersList
            title="Porteros"
            players={teamPlayers.filter(p => p.playerMaster?.positionId === 1)}
            lineup={lineup}
            color="yellow"
          />

          {/* Defenders */}
          <PositionPlayersList
            title="Defensas"
            players={teamPlayers.filter(p => p.playerMaster?.positionId === 2)}
            lineup={lineup}
            color="blue"
          />

          {/* Midfielders */}
          <PositionPlayersList
            title="Centrocampistas"
            players={teamPlayers.filter(p => p.playerMaster?.positionId === 3)}
            lineup={lineup}
            color="green"
          />

          {/* Strikers */}
          <PositionPlayersList
            title="Delanteros"
            players={teamPlayers.filter(p => p.playerMaster?.positionId === 4)}
            lineup={lineup}
            color="red"
          />
        </div>
      </div>

      {/* Player Selection Modal */}
      <AnimatePresence>
        {selectedPosition !== null && (
          <PlayerSelectionModal
            position={selectedPosition.type}
            onClose={() => setSelectedPosition(null)}
            onSelect={handlePlayerSelect}
            getAvailablePlayers={getAvailablePlayersByPosition}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// Position Row Component
const PositionRow = ({ players, count, positionKey, positionType, selectedPosition, onSlotClick, onPlayerRemove }) => {
  const slots = Array.from({ length: count }, (_, i) => players[i] || null);

  return (
    <div className="flex justify-center gap-1.5 sm:gap-4 flex-wrap">
      {slots.map((player, index) => (
        <PlayerSlot
          key={`${positionKey}-${index}`}
          player={player}
          onClick={() => onSlotClick(index)}
          onRemove={() => onPlayerRemove(index)}
          isSelected={selectedPosition?.type === positionType && selectedPosition?.index === index}
        />
      ))}
    </div>
  );
};

// Player Slot Component
const PlayerSlot = ({ player, onClick, onRemove, isSelected }) => {
  return (
    <div className="relative group">
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={onClick}
        className={`w-14 h-14 sm:w-20 sm:h-20 rounded-full flex items-center justify-center transition-all ${
          player
            ? 'bg-white dark:bg-gray-800 shadow-lg border-2 border-white'
            : isSelected
            ? 'bg-primary-500 border-2 border-primary-300 animate-pulse'
            : 'bg-white/50 dark:bg-gray-700/50 border-2 border-dashed border-white/50 hover:bg-white/70'
        }`}
      >
        {player ? (
          <div className="flex flex-col items-center">
            {player.playerMaster?.images?.transparent?.['256x256'] ? (
              <img
                src={player.playerMaster.images.transparent['256x256']}
                alt={player.playerMaster.nickname || player.playerMaster.name}
                className="w-11 h-11 sm:w-16 sm:h-16 object-contain"
              />
            ) : (
              <div className="w-9 h-9 sm:w-12 sm:h-12 bg-primary-100 dark:bg-primary-900/30 rounded-full flex items-center justify-center">
                <span className="text-sm sm:text-lg font-bold text-primary-600 dark:text-primary-400">
                  {(player.playerMaster?.nickname || player.playerMaster?.name || '?').charAt(0)}
                </span>
              </div>
            )}
          </div>
        ) : (
          <User className="w-5 h-5 sm:w-8 sm:h-8 text-gray-400" />
        )}
      </motion.button>

      {/* Player name tooltip */}
      {player && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="bg-gray-900 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
            {player.playerMaster?.nickname || player.playerMaster?.name}
          </div>
        </div>
      )}

      {/* Remove button */}
      {player && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

// Player Selection Modal
const PlayerSelectionModal = ({ position, onClose, onSelect, getAvailablePlayers, searchTerm, setSearchTerm }) => {
  const positionMap = {
    goalkeeper: { id: 1, name: 'Portero', color: 'yellow' },
    defender: { id: 2, name: 'Defensa', color: 'blue' },
    midfield: { id: 3, name: 'Centrocampista', color: 'green' },
    striker: { id: 4, name: 'Delantero', color: 'red' }
  };

  const positionInfo = positionMap[position];
  const availablePlayers = getAvailablePlayers(positionInfo.id);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden"
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 bg-${positionInfo.color}-100 dark:bg-${positionInfo.color}-900/30 rounded-lg`}>
                <Users className={`w-5 h-5 text-${positionInfo.color}-600 dark:text-${positionInfo.color}-400`} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Seleccionar {positionInfo.name}
                </h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {availablePlayers.length} jugadores disponibles
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar jugador..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {/* Players List */}
        <div className="p-4 overflow-y-auto max-h-96">
          {availablePlayers.length === 0 ? (
            <div className="text-center py-12">
              <User className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
              <p className="text-gray-600 dark:text-gray-400">
                No hay jugadores disponibles en esta posición
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {availablePlayers.map((playerTeam) => {
                const player = playerTeam.playerMaster;
                return (
                  <button
                    key={playerTeam.playerTeamId || playerTeam.id}
                    onClick={() => {
                      onSelect(playerTeam, position);
                      onClose();
                    }}
                    className="w-full p-4 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors flex items-center gap-4 text-left"
                  >
                    {/* Player Image */}
                    <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {player.images?.transparent?.['256x256'] ? (
                        <img
                          src={player.images.transparent['256x256']}
                          alt={player.nickname || player.name}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <User className="w-8 h-8 text-gray-400" />
                      )}
                    </div>

                    {/* Player Info */}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900 dark:text-white truncate">
                        {player.nickname || player.name}
                      </div>
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {player.team?.name} • {player.points || 0} pts
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                        Valor: {(player.marketValue || 0).toLocaleString()}€
                      </div>
                    </div>

                    {/* Team Badge */}
                    {player.team?.badgeColor && (
                      <img
                        src={player.team.badgeColor}
                        alt={player.team.name}
                        className="w-10 h-10 object-contain"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

// Position Players List Component
const PositionPlayersList = ({ title, players, lineup, color }) => {
  // Check if player is in lineup
  const isPlayerInLineup = (playerTeam) => {
    const playerTeamId = playerTeam.playerTeamId || playerTeam.id;
    return (
      (lineup.goalkeeper && (lineup.goalkeeper.playerTeamId === playerTeamId || lineup.goalkeeper.id === playerTeamId)) ||
      lineup.defender.some(p => p && (p.playerTeamId === playerTeamId || p.id === playerTeamId)) ||
      lineup.midfield.some(p => p && (p.playerTeamId === playerTeamId || p.id === playerTeamId)) ||
      lineup.striker.some(p => p && (p.playerTeamId === playerTeamId || p.id === playerTeamId))
    );
  };

  const colorClasses = {
    yellow: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800',
    blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
    green: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
    red: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800'
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
          {title}
        </h3>
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colorClasses[color]}`}>
          {players.length}
        </span>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {players.length === 0 ? (
          <div className="text-center py-6 text-gray-400 dark:text-gray-600 text-sm">
            Sin jugadores
          </div>
        ) : (
          players.map((playerTeam) => {
            const player = playerTeam.playerMaster;
            const inLineup = isPlayerInLineup(playerTeam);

            return (
              <div
                key={playerTeam.playerTeamId || playerTeam.id}
                className={`p-3 rounded-lg border transition-all ${
                  inLineup
                    ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800'
                    : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Player Image */}
                  <div className="w-10 h-10 rounded-full bg-white dark:bg-gray-700 flex items-center justify-center overflow-hidden flex-shrink-0 border border-gray-200 dark:border-gray-600">
                    {player.images?.transparent?.['256x256'] ? (
                      <img
                        src={player.images.transparent['256x256']}
                        alt={player.nickname || player.name}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <User className="w-5 h-5 text-gray-400" />
                    )}
                  </div>

                  {/* Player Info */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900 dark:text-white text-sm truncate">
                      {player.nickname || player.name}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                        {player.team?.shortName || player.team?.name}
                      </div>
                      {inLineup && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary-500 text-white whitespace-nowrap flex-shrink-0">
                          En campo
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {player.points || 0}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500">
                      pts
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default LineupEditor;
