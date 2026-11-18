/**
 * Libro de operaciones de la liga reconstruido a partir de la actividad.
 *
 * Tipos de actividad (activityTypeId) usados, verificados contra las
 * plantillas reales (user1 = quien compra / quien actúa):
 *   31 fichó del mercado (LaLiga → user1)           amount = precio
 *    1 compró a otro manager (user2 → user1)        amount = precio
 *   32 clausuló (user2 → user1)                     amount = cláusula
 *   33 vendió a LaLiga (user1 → LaLiga)             amount = precio
 *    6 ganancia por jornada                         amount = ingreso
 *   12 bonus de jornada                             amount = ingreso
 *    2 transferencia entre managers (user1 → user2) amount
 * Funciones puras: sin red ni estado, para poder testearlas.
 */

export const DEFAULT_INITIAL_MONEY = 100_000_000;

const BUY_TYPES = { 31: 'mercado', 1: 'manager', 32: 'clausula' };

const byDateAsc = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);
const str = (v) => (v === undefined || v === null ? null : String(v));

/**
 * Construye el historial de propiedad y los flujos de dinero.
 * @param {Array} activities actividad cruda de la API (cualquier orden)
 * @returns {{
 *   holdings: Map<string, {playerId, managerId, price, date, via}>,
 *   sales: Array<{playerId, managerId, buyPrice, buyDate, sellPrice, sellDate, soldTo, profit}>,
 *   purchases: Array<{playerId, managerId, price, date, via, from}>,
 *   flows: Map<string, Record<string, number>>
 * }}
 */
export const buildLedger = (activities = []) => {
  const holdings = new Map(); // playerId → adquisición vigente
  const sales = [];
  const purchases = [];
  const flows = new Map();

  const addFlow = (managerId, key, amount) => {
    if (!managerId || !amount) return;
    const f = flows.get(managerId) || {};
    f[key] = (f[key] || 0) + amount;
    flows.set(managerId, f);
  };

  const closeHolding = (playerId, sellerId, sellPrice, sellDate, soldTo) => {
    const prev = holdings.get(playerId);
    const known = prev && prev.managerId === sellerId;
    sales.push({
      playerId,
      managerId: sellerId,
      buyPrice: known ? prev.price : null,
      buyDate: known ? prev.date : null,
      sellPrice,
      sellDate,
      soldTo,
      profit: known && prev.price !== null ? sellPrice - prev.price : null,
    });
    holdings.delete(playerId);
  };

  for (const a of [...activities].sort(byDateAsc)) {
    const t = a.activityTypeId;
    const amount = Number(a.amount) || 0;
    const u1 = str(a.user1Id);
    const u2 = str(a.user2Id);
    const playerId = str(a.playerMasterId);

    if (BUY_TYPES[t] && playerId && u1) {
      const via = BUY_TYPES[t];
      if (u2 && t !== 31) {
        closeHolding(playerId, u2, amount, a.createdAt, u1);
        addFlow(u2, via === 'clausula' ? 'clausulasRecibidas' : 'ventasManager', amount);
      }
      addFlow(u1, via === 'mercado' ? 'fichajes' : via === 'clausula' ? 'clausulasPagadas' : 'compras', -amount);
      const acq = { playerId, managerId: u1, price: amount, date: a.createdAt, via };
      holdings.set(playerId, acq);
      purchases.push({ ...acq, from: u2 });
    } else if (t === 33 && playerId && u1) {
      closeHolding(playerId, u1, amount, a.createdAt, 'LaLiga');
      addFlow(u1, 'ventasLaLiga', amount);
    } else if (t === 6) {
      addFlow(u1, 'jornada', amount);
    } else if (t === 12) {
      addFlow(u1, 'bonus', amount);
    } else if (t === 2) {
      addFlow(u1, 'transferencias', -amount);
      addFlow(u2, 'transferencias', amount);
    }
  }

  return { holdings, sales, purchases, flows };
};

/**
 * Precio de compra de un jugador para su dueño actual. Si la última
 * adquisición registrada no es de ese manager (p. ej. reparto inicial),
 * devuelve null: el precio es desconocido.
 */
export const getAcquisition = (ledger, playerId, managerId) => {
  const h = ledger.holdings.get(str(playerId));
  if (!h || h.managerId !== str(managerId)) return null;
  return h;
};

/**
 * Estimación del dinero de un manager:
 *   inicial + ventas + premios − compras − fichajes − cláusulas.
 * No incluye lo gastado en subir cláusulas ni blindajes (no aparecen en la
 * actividad), así que tiende a SOBREESTIMAR. `calibration` permite aplicar
 * la desviación observada en tu propio equipo (dinero real − estimado).
 */
export const estimateMoney = (ledger, managerId, {
  initialMoney = DEFAULT_INITIAL_MONEY,
  calibration = 0,
} = {}) => {
  const f = ledger.flows.get(str(managerId)) || {};
  const net = Object.values(f).reduce((s, v) => s + v, 0);
  return {
    estimated: initialMoney + net,
    calibrated: initialMoney + net + calibration,
    breakdown: f,
  };
};
