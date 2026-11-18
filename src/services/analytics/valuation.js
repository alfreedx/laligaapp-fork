/**
 * Cálculos de rentabilidad (económica y deportiva) de un jugador.
 * Replica las columnas del Excel del usuario y añade métricas extra.
 * Funciones puras.
 */

export const LALIGA_OFFER_FACTOR = 1.10; // mayor oferta posible de LaLiga (+10 %)
export const PROJECTION_DAYS = 5;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const diffOrNull = (a, b) => (isNum(a) && isNum(b) ? a - b : null);

/**
 * Ritmos de crecimiento diario a partir del histórico de futbolfantasy
 * (valor, valor1, valor3, valor7 = valor hoy / hace 1, 3, 7 días).
 */
export const growthRates = (trend) => {
  if (!trend || !isNum(trend.valor)) return { daily: null, avg3: null, avg7: null };
  const per = (past, days) => (isNum(past) && past > 0 ? (trend.valor - past) / days : null);
  return {
    daily: isNum(trend.diferencia1) ? trend.diferencia1 : per(trend.valor1, 1),
    avg3: per(trend.valor3, 3),
    avg7: per(trend.valor7, 7),
  };
};

/**
 * Fila de rentabilidad.
 * @param {object} p
 * @param {number|null} p.buyPrice   precio de compra (o precio de venta en mercado)
 * @param {number|null} p.sellPrice  precio de venta (si ya se vendió)
 * @param {number}      p.value      valor de mercado actual (API)
 * @param {object|null} p.trend      entrada de futbolfantasy (valor, valor1…, diferencia1…)
 * @param {number|null} p.points     puntos totales
 * @param {number|null} p.averagePoints media
 * @param {'daily'|'avg3'|'avg7'} [p.rateMode='daily'] ritmo usado en la proyección
 */
export const computeProfitability = ({
  buyPrice = null,
  sellPrice = null,
  value,
  trend = null,
  points = null,
  averagePoints = null,
  rateMode = 'daily',
  days = PROJECTION_DAYS,
}) => {
  const rates = growthRates(trend);
  const rate = rates[rateMode] ?? rates.daily;
  const laLigaMax = isNum(value) ? value * LALIGA_OFFER_FACTOR : null;
  const valueN = isNum(value) && isNum(rate) ? value + days * rate : null;
  const laLigaN = isNum(valueN) ? valueN * LALIGA_OFFER_FACTOR : null;
  const valueM = isNum(value) && value > 0 ? value / 1e6 : null;

  return {
    buyPrice,
    sellPrice,
    effectiveGain: diffOrNull(sellPrice, buyPrice),
    value,
    laLigaMax,
    latentGain: diffOrNull(value, buyPrice),
    latentGainLaLiga: diffOrNull(laLigaMax, buyPrice),
    dailyGrowth: rates.daily,
    growthAvg3: rates.avg3,
    growthAvg7: rates.avg7,
    valueN,
    laLigaN,
    gainN: diffOrNull(valueN, buyPrice),
    gainNLaLiga: diffOrNull(laLigaN, buyPrice),
    roiPct: isNum(buyPrice) && buyPrice > 0 && isNum(value) ? ((value - buyPrice) / buyPrice) * 100 : null,
    // Deportivo
    points,
    averagePoints,
    pointsPerMillion: isNum(points) && valueM ? points / valueM : null,
    avgPerMillion: isNum(averagePoints) && valueM ? averagePoints / valueM : null,
  };
};
