import { dueClauseAlerts } from './clauseAlerts';

test('avisa solo aperturas ya ocurridas, recientes y no avisadas', () => {
  const now = new Date('2026-11-19T19:30:00Z');
  const watch = [
    { id: '1', openAt: '2026-11-19T19:00:00Z' },           // abierta hace 30 min → avisar
    { id: '2', openAt: '2026-11-19T20:00:00Z' },           // futura
    { id: '5', openAt: '2026-11-19T19:32:00Z' },           // en 2 min → avisar
    { id: '6', openAt: '2026-11-19T19:33:00Z' },           // en 3 min → aún no
    { id: '3', openAt: '2026-11-18T05:00:00Z' },           // hace > 12 h → no
    { id: '4', openAt: '2026-11-19T19:10:00Z' },           // ya avisada
  ];
  const due = dueClauseAlerts(watch, ['4|2026-11-19T19:10:00Z'], now);
  expect(due.map((w) => w.id)).toEqual(['1', '5']);
});
