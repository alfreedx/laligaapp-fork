import { classifyOffers } from './offers';

const row = (o) => ({ id: '1', positionId: 3, status: 'ok', value: 50e6, xp: 6, playProb: 0.9, ...o });

test('una oferta solo es buena si supera el valor en un 5 %', () => {
  const [a, b] = classifyOffers([
    { r: row({ id: 'a' }), money: 52e6 }, // +4 %
    { r: row({ id: 'b' }), money: 52.5e6 }, // +5 %
  ], { starterIds: new Set(['a', 'b']) });
  expect(a.good).toBe(false);
  expect(a.level).toBeNull();
  expect(b.good).toBe(true);
});

test('titular que rinde → oportunidad; con motivo deportivo → fuerte', () => {
  const starters = new Set(['cucurella', 'pepelu']);
  const [cucu, lesion, banquillo, malaJ] = classifyOffers([
    { r: row({ id: 'cucurella' }), money: 54e6 },
    { r: row({ id: 'pepelu', status: 'injured' }), money: 54e6 },
    { r: row({ id: 'x' }), money: 54e6 },
    { r: row({ id: 'pepelu', xp: 1.5 }), money: 54e6 },
  ], { starterIds: starters });
  expect(cucu.level).toBe('oportunidad');
  expect(cucu.reasons).toEqual([]);
  expect(lesion.level).toBe('fuerte');
  expect(lesion.reasons).toContain('lesionado');
  expect(banquillo.reasons).toContain('no está en tu once');
  expect(malaJ.reasons[0]).toMatch(/mala jornada/);
});

test('entrenador: fuerte solo si no es el recomendado', () => {
  const [c1, c2] = classifyOffers([
    { r: row({ id: 'sim', positionId: 5, xp: null }), money: 60e6 },
    { r: row({ id: 'lg', positionId: 5, xp: null }), money: 60e6 },
  ], { coachId: 'sim' });
  expect(c1.level).toBe('oportunidad');
  expect(c2.level).toBe('fuerte');
});
