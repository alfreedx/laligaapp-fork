/**
 * Generadores de filas para las tablas de Rentabilidad y para el informe
 * diario. Funciones puras: reciben los datos ya descargados.
 */
import { getAcquisition, estimateMoney } from './ledger';
import { computeProfitability } from './valuation';
import { forecastPoints } from './forecast';

export const POSITION_LABEL = { 1: 'POR', 2: 'DEF', 3: 'MED', 4: 'DEL', 5: 'ENT' };

const clauseInfo = (playerTeam) => {
  const end = playerTeam?.buyoutClauseLockedEndTime || null;
  const openAt = end ? new Date(end) : null;
  const isOpen = !openAt || openAt <= new Date();
  return {
    clause: playerTeam?.buyoutClause ?? null,
    clauseOpenAt: openAt ? openAt.toISOString() : null,
    clauseIsOpen: isOpen,
    isShielded: !!playerTeam?.isShielded,
  };
};

const baseInfo = (pm, extra = {}) => ({
  id: String(pm?.id),
  name: pm?.nickname || pm?.name || '¿?',
  fullName: pm?.name || '',
  positionId: pm?.positionId ?? null,
  position: POSITION_LABEL[pm?.positionId] || '',
  team: pm?.team?.name || extra.teamName || '',
  status: pm?.playerStatus || 'ok',
  playerMaster: pm,
  ...extra,
});

/** Mi plantilla: precio de compra real (actividad) + rentabilidad. */
export const buildSquadRows = ({ team, ledger, resolveTrend, rateMode = 'daily' }) => {
  if (!team) return [];
  return team.players.map((pt) => {
    const pm = pt.playerMaster;
    const acq = ledger ? getAcquisition(ledger, pm?.id, team.managerId) : null;
    const trend = resolveTrend ? resolveTrend(pm) : null;
    return {
      ...baseInfo(pm),
      owner: team.managerName,
      ownerId: team.managerId,
      acquiredVia: acq?.via || 'inicial',
      acquiredAt: acq?.date || null,
      inMarket: !!pt.playerMarket,
      marketExpiration: pt.playerMarket?.expirationDate || null,
      marketOffers: pt.playerMarket?.numberOfOffers ?? null,
      playerTeamId: pt.playerTeamId,
      ...clauseInfo(pt),
      ...forecastPoints(pm, trend),
      ...computeProfitability({
        buyPrice: acq?.price ?? null,
        value: pm?.marketValue,
        trend,
        points: pm?.points ?? null,
        averagePoints: pm?.averagePoints ?? null,
        rateMode,
      }),
    };
  });
};

/** Mercado del día: "precio de compra" = precio de salida actual. */
export const buildMarketRows = ({ market, ownerByPlayer, resolveTrend, rateMode = 'daily' }) =>
  (market || []).map((m) => {
    const pm = m.playerMaster || {};
    const owner = ownerByPlayer?.get(String(pm.id)) || null;
    const trend = resolveTrend ? resolveTrend(pm) : null;
    return {
      ...baseInfo(pm),
      marketId: m.id,
      seller: owner ? owner.managerName : 'LaLiga',
      sellerId: owner?.managerId || null,
      expiration: m.expirationDate || null,
      bids: m.numberOfBids ?? m.numberOfOffers ?? 0,
      ...forecastPoints(pm, trend),
      ...computeProfitability({
        buyPrice: m.salePrice ?? pm.marketValue,
        value: pm.marketValue,
        trend,
        points: pm.points ?? null,
        averagePoints: pm.averagePoints ?? null,
        rateMode,
      }),
    };
  });

/**
 * Jugadores de los rivales: lo que pagó su dueño, su cláusula, cuándo se
 * abre y cuánto ganarías tú si lo clausulas y lo revendes (a valor o a
 * LaLiga +10 %) en N días.
 */
export const buildRivalRows = ({ teams, myTeamId, ledger, resolveTrend, rateMode = 'daily' }) => {
  const rows = [];
  (teams || []).filter((t) => t.teamId !== myTeamId).forEach((team) => {
    team.players.forEach((pt) => {
      const pm = pt.playerMaster;
      const acq = ledger ? getAcquisition(ledger, pm?.id, team.managerId) : null;
      const trend = resolveTrend ? resolveTrend(pm) : null;
      const prof = computeProfitability({
        buyPrice: acq?.price ?? null,
        value: pm?.marketValue,
        trend,
        points: pm?.points ?? null,
        averagePoints: pm?.averagePoints ?? null,
        rateMode,
      });
      const ci = clauseInfo(pt);
      rows.push({
        ...baseInfo(pm),
        ...forecastPoints(pm, trend),
        owner: team.managerName,
        ownerId: team.managerId,
        acquiredVia: acq?.via || 'inicial',
        acquiredAt: acq?.date || null,
        inMarket: !!pt.playerMarket,
        ...ci,
        ...prof,
        // Desde TU punto de vista, comprando por cláusula:
        clauseGainNow: ci.clause != null && prof.laLigaMax != null ? prof.laLigaMax - ci.clause : null,
        clauseGainN: ci.clause != null && prof.laLigaN != null ? prof.laLigaN - ci.clause : null,
        clauseOverValuePct: ci.clause != null && pm?.marketValue ? ((ci.clause - pm.marketValue) / pm.marketValue) * 100 : null,
      });
    });
  });
  return rows;
};

/** Dinero estimado de cada manager (y desviación calibrada con el tuyo). */
export const buildMoneyRows = ({ teams, ledger, myTeam, myMoney, initialMoney, clauseSpend = null }) => {
  if (!ledger) return [];
  // Gasto detectado en subidas de cláusula (capturas diarias) → se descuenta de la base
  const spentOnClauses = (id) => (clauseSpend?.get(String(id)) || 0);
  const mine = myTeam ? estimateMoney(ledger, myTeam.managerId, { initialMoney }) : null;
  const calibration = mine && typeof myMoney === 'number' ? myMoney - (mine.estimated - spentOnClauses(myTeam.managerId)) : 0;
  return (teams || []).map((t) => {
    const raw = estimateMoney(ledger, t.managerId, { initialMoney });
    const base = raw.estimated - spentOnClauses(t.managerId);
    const e = { ...raw, estimated: base, calibrated: base + calibration };
    const isMe = myTeam && t.teamId === myTeam.teamId;
    const b = e.breakdown;
    return {
      id: t.teamId,
      name: t.managerName,
      isMe,
      position: t.position,
      points: t.teamPoints,
      teamValue: t.teamValue,
      realMoney: isMe ? myMoney : null,
      estimated: e.estimated,
      calibrated: isMe ? myMoney : e.calibrated,
      spent: -((b.fichajes || 0) + (b.compras || 0) + (b.clausulasPagadas || 0)),
      earned: (b.ventasLaLiga || 0) + (b.ventasManager || 0) + (b.clausulasRecibidas || 0),
      prizes: (b.jornada || 0) + (b.bonus || 0),
      // Poder de compra máximo: dinero + vender toda la plantilla a valor
      maxBuyingPower: (isMe ? myMoney ?? e.estimated : e.calibrated) + (t.teamValue || 0),
      clauseRaiseSpend: spentOnClauses(t.managerId),
      calibration,
    };
  });
};

/** Ventas cerradas (ganancia efectiva) de un manager. */
export const buildSalesRows = ({ ledger, managerId, playerNames }) =>
  (ledger?.sales || [])
    .filter((s) => s.managerId === String(managerId))
    .map((s) => ({
      id: `${s.playerId}-${s.sellDate}`,
      name: playerNames?.get(s.playerId) || `#${s.playerId}`,
      buyPrice: s.buyPrice,
      buyDate: s.buyDate,
      sellPrice: s.sellPrice,
      sellDate: s.sellDate,
      soldTo: s.soldTo,
      effectiveGain: s.profit,
    }))
    .sort((a, b) => new Date(b.sellDate) - new Date(a.sellDate));
