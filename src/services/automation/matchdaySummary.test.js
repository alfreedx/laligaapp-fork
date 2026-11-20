import { buildMatchdaySummary, renderMatchdayTelegram as toTelegram } from './matchdaySummary';
import { isMatchdaySummaryDue, matchdaySummaryTime } from './matchdayJob';

const p = (id, positionId, xp, extra = {}) => ({ id, name: `J${id}`, positionId, xp, status: 'ok', playProb: 0.9, ...extra });

const squad = [
  p('1', 1, 4), p('2', 2, 5), p('3', 2, 4), p('4', 2, 4), p('5', 2, 3),
  p('6', 3, 6), p('7', 3, 5), p('8', 3, 4), p('9', 3, 1, { status: 'injured' }),
  p('10', 4, 7), p('11', 4, 5), p('12', 4, 6), p('c', 5, 3),
];
const rec = { formation: '4-3-3', starters: squad.filter((x) => !['9', 'c', '8'].includes(x.id)).concat([squad[7]]), captain: squad[9], coach: squad[12] };
rec.total = rec.starters.reduce((s, x) => s + x.xp, 0) + 7 + 3;
const model = { week: 13, weekStart: '2026-11-20T20:00:00Z', kpis: { rank: 1, points: 780, gap: 12, closest: 'Rival' }, lineup: rec, _raw: { squad } };

test('resumen: puntos de la alineación guardada, alertas y cambios sugeridos', () => {
  // Guardada: alineado el lesionado (9) en lugar del 12, capitán 10
  const ids = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11']);
  const s = buildMatchdaySummary(model, { ids, formation: '4-4-2', captainId: '10', coachId: 'c' });
  expect(s.starters).toHaveLength(11);
  expect(s.total).toBeCloseTo(48 + 7 + 3);
  expect(s.problems.map((x) => x.id)).toEqual(['9']);
  expect(s.swaps.in.map((x) => x.id)).toEqual(['12']);
  const txt = toTelegram(s);
  expect(txt).toContain('Jornada 13');
  expect(txt).toContain('lesionado');
  expect(txt).toContain('Entran: J12');
});

test('cuándo toca el resumen: 1 h antes del primer partido y una sola vez', () => {
  const st = { nextKickoff: '2026-11-20T20:00:00.000Z' };
  expect(isMatchdaySummaryDue(st, {}, new Date('2026-11-20T18:59:00Z'))).toBe(false);
  expect(isMatchdaySummaryDue(st, {}, new Date('2026-11-20T19:00:00Z'))).toBe(true);
  expect(isMatchdaySummaryDue(st, {}, new Date('2026-11-20T20:00:00Z'))).toBe(false);
  expect(isMatchdaySummaryDue({ ...st, lastMatchdaySummaryFor: st.nextKickoff }, {}, new Date('2026-11-20T19:30:00Z'))).toBe(false);
  expect(isMatchdaySummaryDue(st, { matchdaySummaryEnabled: false }, new Date('2026-11-20T19:30:00Z'))).toBe(false);
  expect(matchdaySummaryTime(st.nextKickoff, new Date('2026-11-20T10:00:00Z'))).toBe('2026-11-20T19:00:00.000Z');
  expect(matchdaySummaryTime(st.nextKickoff, new Date('2026-11-20T19:30:00Z'))).toBeNull();
});
