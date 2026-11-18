/**
 * Protección de la plantilla frente a cláusulas: qué jugadores propios están
 * expuestos (cláusula abierta o que se abre pronto), qué rivales podrían
 * pagarla y qué hacer (blindar / subir cláusula / asumir). Funciones puras.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const H = 3600 * 1000;

/**
 * @param {object} p
 * @param {Array}  p.squad        filas de buildSquadRows (con xp)
 * @param {Array}  p.money        filas de buildMoneyRows (calibrated = dinero estimado)
 * @param {Set}    p.starterIds   ids del once recomendado
 * @param {number} [p.hours=48]   ventana de "se abre pronto"
 * @param {number} [p.costFactor=0.5]  coste supuesto de subir la cláusula (× aumento)
 * @param {number} [p.margin=0.05]     margen sobre el dinero del rival más rico
 * @param {Date}   [p.now]
 */
export const buildProtectionPlan = ({ squad, money, starterIds = new Set(), hours = 48, costFactor = 0.5, margin = 0.05, maxCostShare = 0.5, now = new Date() }) => {
  const rivals = (money || []).filter((m) => !m.isMe && isNum(m.calibrated));
  return (squad || [])
    .filter((r) => !r.isShielded && isNum(r.clause))
    .filter((r) => r.clauseIsOpen || (r.clauseOpenAt && new Date(r.clauseOpenAt) - now <= hours * H))
    .map((r) => {
      const canPay = rivals.filter((m) => m.calibrated >= r.clause).sort((a, b) => b.calibrated - a.calibrated);
      const isStarter = starterIds.has(r.id);
      const ifClausedGain = isNum(r.buyPrice) ? r.clause - r.buyPrice : null;
      // Subida razonable: la que deja fuera a más rivales sin costar más de
      // `maxCostShare` × valor del jugador. Si no deja fuera a todos → blindar.
      const maxCost = isNum(r.value) ? r.value * maxCostShare : 0;
      let targetClause = null;
      let raiseCost = null;
      let excluded = 0;
      for (let i = canPay.length - 1; i >= 0; i--) { // de menos a más rico
        const t = Math.ceil((canPay[i].calibrated * (1 + margin)) / 100_000) * 100_000;
        const cost = (t - r.clause) * costFactor;
        if (cost > maxCost) break;
        targetClause = t;
        raiseCost = cost;
        excluded = canPay.length - i;
      }
      const remaining = canPay.length - excluded;
      const M1 = (v) => `${(v / 1e6).toFixed(1).replace('.', ',')} M`;

      let action;
      let reason;
      if (!canPay.length) {
        action = 'Sin riesgo';
        reason = 'Ningún rival tiene dinero estimado suficiente.';
      } else if (isStarter || (isNum(r.xp) && r.xp >= 5)) {
        action = 'Proteger';
        if (targetClause && remaining === 0) {
          reason = `${isStarter ? 'Titular' : 'Buen rendimiento'}. Subir la cláusula a ${M1(targetClause)} (coste ≈ ${M1(raiseCost)}) deja fuera a todos los rivales; o blíndalo.`;
        } else if (targetClause) {
          reason = `${isStarter ? 'Titular' : 'Buen rendimiento'}. Subirla a ${M1(targetClause)} (≈ ${M1(raiseCost)}) solo deja fuera a ${excluded} de ${canPay.length}; mejor **blindar** (siguen pudiendo: ${canPay.slice(0, remaining).map((m) => m.name).join(', ')}).`;
        } else {
          reason = `${isStarter ? 'Titular' : 'Buen rendimiento'} y ${canPay.length} rival(es) pueden pagarla; subir la cláusula no compensa → **blíndalo**.`;
        }
      } else if (isNum(ifClausedGain) && ifClausedGain >= 0) {
        action = 'Asumible';
        reason = `Suplente; si te lo clausulan ganas ${(ifClausedGain / 1e6).toFixed(1).replace('.', ',')} M sobre lo que pagaste.`;
      } else {
        action = 'Valorar';
        reason = 'Suplente, pero perderías dinero si te lo clausulan.';
      }
      return {
        ...r,
        isStarter,
        canPay: canPay.map((m) => m.name),
        richestRival: canPay[0]?.name || null,
        targetClause,
        raiseCost,
        rivalsExcluded: excluded,
        ifClausedGain,
        action,
        reason,
      };
    })
    .sort((a, b) => {
      const order = { Proteger: 0, Valorar: 1, Asumible: 2, 'Sin riesgo': 3 };
      return (order[a.action] - order[b.action]) || ((b.xp ?? 0) - (a.xp ?? 0));
    });
};
