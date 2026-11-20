/**
 * Calendario de la jornada y bloqueo de cláusulas. Funciones puras.
 *
 * Regla de LaLiga Fantasy: desde 24 h antes del primer partido de la jornada
 * hasta que empieza ese partido no se puede pagar ninguna cláusula. Por eso,
 * una cláusula "abierta" o que se abre dentro de esa ventana no es
 * clausulable hasta el inicio del primer partido.
 */

export const CLAUSE_LOCK_MS = 24 * 3600 * 1000;
export const MATCHDAY_SUMMARY_LEAD_MS = 60 * 60 * 1000; // resumen 1 h antes del primer partido

const toTime = (v) => {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
};

/** Hora (ISO) del primer partido de una lista de partidos del calendario. */
export const firstKickoff = (matches) => {
  const times = (matches || [])
    .map((m) => toTime(m?.matchDate || m?.date || m?.kickoff))
    .filter((t) => t !== null);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
};

/**
 * Próximo inicio de jornada (primer partido que aún no ha empezado).
 * @param {object} p
 * @param {number} p.week            jornada actual según la API
 * @param {string} [p.weekKickoff]   primer partido de esa jornada (calendario)
 * @param {string} [p.nextKickoff]   primer partido de la siguiente (calendario)
 * @param {string} [p.openingWeekDate] respaldo si no hay calendario
 */
export const resolveMatchday = ({ week, weekKickoff, nextKickoff, openingWeekDate, now = new Date() }) => {
  const nowT = now.getTime();
  const current = weekKickoff || openingWeekDate || null;
  if (current && toTime(current) > nowT) return { week, kickoff: current, started: false };
  // La jornada actual ya empezó: el próximo inicio es el de la siguiente
  return {
    week: nextKickoff && week ? week + 1 : week,
    kickoff: nextKickoff && toTime(nextKickoff) > nowT ? nextKickoff : null,
    started: !!current,
    currentKickoff: current,
  };
};

/** Ventana de bloqueo [inicio, fin) para un inicio de jornada. */
export const clauseLockWindow = (kickoff) => {
  const end = toTime(kickoff);
  if (end === null) return null;
  return { start: new Date(end - CLAUSE_LOCK_MS).toISOString(), end: new Date(end).toISOString() };
};

export const isClauseLocked = (kickoff, now = new Date()) => {
  const w = clauseLockWindow(kickoff);
  if (!w) return false;
  const t = now.getTime();
  return t >= toTime(w.start) && t < toTime(w.end);
};

/**
 * Cuándo se puede pagar de verdad la cláusula de una fila (squad/rival),
 * teniendo en cuenta el bloqueo de jornada. Devuelve la fila con
 * clauseIsOpen / clauseOpenAt corregidos y `clauseLockedUntil` si el
 * bloqueo la retrasa (útil para explicarlo en el informe).
 */
export const applyClauseLock = (row, kickoff, now = new Date()) => {
  const w = clauseLockWindow(kickoff);
  if (!w || !row || row.isShielded) return row;
  const start = toTime(w.start);
  const end = toTime(w.end);
  const nowT = now.getTime();
  const openT = row.clauseIsOpen ? nowT : toTime(row.clauseOpenAt);
  if (openT === null) return row;
  // Se podría pagar dentro de la ventana de bloqueo → se retrasa al primer partido
  if (openT >= start && openT < end) {
    return { ...row, clauseIsOpen: false, clauseOpenAt: w.end, clauseLockedUntil: w.end };
  }
  return row;
};
