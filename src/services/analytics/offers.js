/**
 * Clasificación de las ofertas recibidas por mis jugadores. Función pura.
 *
 *  - Oferta buena: al menos un 5 % por encima del valor de mercado actual.
 *  - 🔴 Venta fuerte: oferta buena y además motivo deportivo para vender
 *    (lesión/sanción, poca probabilidad de jugar, fuera del once recomendado,
 *    mala jornada prevista).
 *  - 🟡 Oportunidad: oferta buena, pero el jugador rinde. Se informa, no se insiste.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const GOOD_OFFER_PREMIUM = 0.05;
export const LOW_XP = 3; // puntos esperados por debajo de esto = mala jornada prevista
export const LOW_PLAY_PROB = 0.5;

/**
 * @param {Array} offers  [{ r: filaPlantilla, money, ... }]
 * @param {object} ctx
 * @param {Set<string>} ctx.starterIds ids de los titulares del once recomendado
 * @param {string|null} ctx.coachId    entrenador recomendado
 */
export const classifyOffers = (offers, { starterIds = new Set(), coachId = null, minPremium = GOOD_OFFER_PREMIUM } = {}) =>
  (offers || []).map((o) => {
    const { r } = o;
    const premium = isNum(o.money) && isNum(r.value) && r.value > 0 ? o.money / r.value - 1 : null;
    const good = isNum(premium) && premium >= minPremium - 1e-9;
    const reasons = [];
    if (r.status === 'injured') reasons.push('lesionado');
    if (r.status === 'suspended') reasons.push('sancionado');
    if (r.positionId === 5) {
      if (coachId && String(r.id) !== String(coachId)) reasons.push('no es tu entrenador recomendado');
    } else {
      if (!['injured', 'suspended'].includes(r.status) && isNum(r.playProb) && r.playProb < LOW_PLAY_PROB) {
        reasons.push(`${Math.round(r.playProb * 100)} % de jugar`);
      }
      if (!starterIds.has(String(r.id))) reasons.push('no está en tu once');
      if (isNum(r.xp) && r.xp < LOW_XP) reasons.push(`mala jornada prevista (xP ${r.xp.toFixed(1).replace('.', ',')})`);
    }
    let level = null;
    if (good) level = reasons.length ? 'fuerte' : 'oportunidad';
    return { ...o, premium, good, level, reasons };
  });
