import { buildPredictionRecord, actualPointsForWeek, evaluateWeek, bestVariant } from './backtest';

const rows = [
  { id: '1', name: 'A', positionId: 3, xp: 6, seasonAvg: 5, form: 8, playProb: 1, venueFactor: 1 },
  { id: '2', name: 'B', positionId: 4, xp: 4, seasonAvg: 4, form: 4, playProb: 1, venueFactor: 1 },
  { id: '9', name: 'Coach', positionId: 5, xp: 3, seasonAvg: 3, playProb: 1 },
];

test('guarda previsión de cada variante (sin entrenadores)', () => {
  const rec = buildPredictionRecord(rows, { lineupIds: ['1', '2'], captainId: '1' });
  expect(Object.keys(rec.players)).toEqual(['1', '2']);
  expect(rec.players['1']).toMatchObject({ modelo: 6, media: 5, forma: 8 });
});

test('puntos reales: 0 si no jugó en una jornada cubierta', () => {
  const teams = [{ players: [
    { playerMaster: { id: '1', positionId: 3, lastStats: [{ weekNumber: 12, totalPoints: 7 }, { weekNumber: 14, totalPoints: 2 }] } },
    { playerMaster: { id: '2', positionId: 4, lastStats: [{ weekNumber: 13, totalPoints: 10 }] } },
  ] }];
  const act = actualPointsForWeek(teams, 13);
  expect(act.get('1')).toBe(0);
  expect(act.get('2')).toBe(10);
});

test('evalúa variantes, fallos y el once', () => {
  const rec = buildPredictionRecord(rows, { lineupIds: ['1', '2'], captainId: '1' });
  const actual = new Map([['1', 8], ['2', 2]]);
  const ev = evaluateWeek(rec, actual);
  expect(ev.variants.modelo.mae).toBeCloseTo(2);   // |6-8|, |4-2|
  expect(ev.variants.forma.mae).toBeCloseTo(1);    // |8-8|, |4-2|
  expect(ev.lineup).toMatchObject({ predicted: 16, actual: 18, known: 2 });
  expect(bestVariant({ 13: ev })[0].variant).toBe('forma');
});
