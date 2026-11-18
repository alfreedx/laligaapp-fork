/**
 * Horario de los informes. Cada hora programada genera una "edición":
 *   - antes del reseteo del mercado (19:00) → 'cierre'  (actuar sobre el mercado del día)
 *   - después del reseteo                    → 'apertura' (mercado nuevo; auto-mercado)
 * Funciones puras.
 */

export const MARKET_RESET = { h: 19, m: 0 };

export const EDITIONS = {
  cierre: { label: 'Antes del cierre', icon: '⏳' },
  apertura: { label: 'Mercado nuevo', icon: '🆕' },
};

export const parseTime = (t) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? { h, m: min } : null;
};

export const editionForTime = ({ h, m }, reset = MARKET_RESET) =>
  (h * 60 + m < reset.h * 60 + reset.m ? 'cierre' : 'apertura');

/** Horas válidas y ordenadas de los ajustes (compatibilidad con el antiguo runHour/runMinute). */
export const scheduleTimes = (settings = {}) => {
  let times = Array.isArray(settings.runTimes) ? settings.runTimes : [];
  if (!times.length && Number.isFinite(settings.runHour)) {
    times = [`${settings.runHour}:${String(settings.runMinute ?? 0).padStart(2, '0')}`];
  }
  return [...new Set(times.map(parseTime).filter(Boolean).map(({ h, m }) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`))].sort();
};

/** Hora programada más reciente que ya ha pasado (hoy o ayer). */
export const lastSlot = (now, settings) => {
  const times = scheduleTimes(settings);
  let best = null;
  times.forEach((t) => {
    const { h, m } = parseTime(t);
    const at = new Date(now);
    at.setHours(h, m, 0, 0);
    if (at > now) at.setDate(at.getDate() - 1);
    if (!best || at > best.at) best = { at, time: t, edition: editionForTime({ h, m }) };
  });
  return best;
};

/** ¿Toca ejecutar? Sí si no hubo ejecución correcta desde la última hora programada. */
export const isRunDue = (state, settings, now = new Date()) => {
  if (!settings?.dailyReportEnabled) return false;
  const slot = lastSlot(now, settings);
  if (!slot) return false;
  const last = state?.lastSuccessAt ? new Date(state.lastSuccessAt) : null;
  return !last || last < slot.at;
};

/** Edición que corresponde ahora (para ejecuciones manuales o con retraso). */
export const currentEdition = (now, settings) => lastSlot(now, settings)?.edition
  || editionForTime({ h: now.getHours(), m: now.getMinutes() });
