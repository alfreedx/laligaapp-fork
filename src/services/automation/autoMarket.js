/**
 * Auto-mercado: vuelve a poner a la venta (a su valor de mercado) los
 * jugadores propios que no están en el mercado, para recibir la oferta
 * diaria de LaLiga. ÚNICA acción de escritura automática de la app, pedida
 * explícitamente por el usuario. Nunca acepta ofertas, puja ni retira.
 */
import { fantasyAPI } from '../api';
import { isSuccessResponse } from '../../utils/helpers';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY_MS = 1500;      // ritmo "humano" entre acciones
const MAX_ACTIONS = 30;     // tope de seguridad por ejecución

/** Jugadores que deberían ponerse a la venta (función pura, testeable). */
export const planAutoMarket = (myTeam, { excluded = [] } = {}) => {
  if (!myTeam) return [];
  const skip = new Set(excluded.map(String));
  return myTeam.players
    .filter((pt) => !pt.playerMarket)
    .filter((pt) => !skip.has(String(pt.playerMaster?.id)))
    .filter((pt) => (pt.playerTeamId || pt.id) && pt.playerMaster?.marketValue > 0)
    .slice(0, MAX_ACTIONS)
    .map((pt) => ({
      playerId: String(pt.playerMaster.id),
      playerTeamId: String(pt.playerTeamId || pt.id),
      name: pt.playerMaster.nickname || pt.playerMaster.name,
      price: Math.round(pt.playerMaster.marketValue),
    }));
};

/**
 * Ejecuta el plan. En dryRun solo devuelve lo que haría.
 * @returns {Promise<Array<{name, price, status: 'listed'|'simulated'|'error', error?}>>}
 */
export const runAutoMarket = async ({ leagueId, myTeam, excluded, dryRun = true }) => {
  const plan = planAutoMarket(myTeam, { excluded });
  const log = [];
  for (const item of plan) {
    if (dryRun) {
      log.push({ ...item, status: 'simulated' });
      continue;
    }
    try {
      const res = await fantasyAPI.sellPlayerToMarket(leagueId, item.playerTeamId, item.price);
      log.push({ ...item, status: isSuccessResponse(res) ? 'listed' : 'error', error: isSuccessResponse(res) ? undefined : `HTTP ${res?.status}` });
    } catch (e) {
      log.push({ ...item, status: 'error', error: e?.response?.data?.message || e.message });
    }
    await sleep(DELAY_MS);
  }
  return log;
};
