import {
  firstKickoff, resolveMatchday, clauseLockWindow, isClauseLocked, applyClauseLock,
} from './matchday';

const KO = '2026-11-20T20:00:00.000Z'; // vie 21:00 (Madrid)

test('primer partido del calendario', () => {
  expect(firstKickoff([{ matchDate: '2026-11-21T15:00:00Z' }, { date: KO }, { matchDate: 'x' }])).toBe(KO);
  expect(firstKickoff([])).toBeNull();
});

test('próximo inicio: jornada actual si no ha empezado, si no la siguiente', () => {
  expect(resolveMatchday({ week: 13, weekKickoff: KO, now: new Date('2026-11-20T10:00:00Z') }))
    .toMatchObject({ week: 13, kickoff: KO, started: false });
  const next = '2026-11-27T20:00:00.000Z';
  expect(resolveMatchday({ week: 13, weekKickoff: KO, nextKickoff: next, now: new Date('2026-11-22T10:00:00Z') }))
    .toMatchObject({ week: 14, kickoff: next, started: true });
  // Sin calendario: respaldo con openingWeekDate
  expect(resolveMatchday({ week: 13, openingWeekDate: KO, now: new Date('2026-11-20T10:00:00Z') }).kickoff).toBe(KO);
});

test('ventana de bloqueo de 24 h', () => {
  expect(clauseLockWindow(KO)).toEqual({ start: '2026-11-19T20:00:00.000Z', end: KO });
  expect(isClauseLocked(KO, new Date('2026-11-20T10:00:00Z'))).toBe(true);
  expect(isClauseLocked(KO, new Date('2026-11-19T19:00:00Z'))).toBe(false);
  expect(isClauseLocked(KO, new Date('2026-11-20T20:00:00Z'))).toBe(false); // ya empezó
});

test('cláusulas dentro del bloqueo se retrasan al primer partido', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  // Abierta ahora (bloqueada) → disponible al primer partido
  expect(applyClauseLock({ clauseIsOpen: true }, KO, now)).toMatchObject({ clauseIsOpen: false, clauseOpenAt: KO, clauseLockedUntil: KO });
  // Se abre dentro de la ventana → al primer partido
  expect(applyClauseLock({ clauseIsOpen: false, clauseOpenAt: '2026-11-20T15:00:00Z' }, KO, now).clauseOpenAt).toBe(KO);
  // Se abre después del primer partido → sin cambios
  const later = { clauseIsOpen: false, clauseOpenAt: '2026-11-21T18:22:00Z' };
  expect(applyClauseLock(later, KO, now)).toBe(later);
  // Fuera de la ventana (ayer por la mañana) → abierta de verdad
  const before = new Date('2026-11-19T08:00:00Z');
  expect(applyClauseLock({ clauseIsOpen: true }, KO, before).clauseIsOpen).toBe(true);
  // Blindado → sin cambios
  const sh = { isShielded: true, clauseIsOpen: true };
  expect(applyClauseLock(sh, KO, now)).toBe(sh);
});
