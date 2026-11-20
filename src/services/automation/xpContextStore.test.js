import { serializeXpContext, deserializeXpContext, xpContextAgeDays } from './xpContextStore';

test('el contexto del xP sobrevive a JSON (Map incluidos) y lleva fecha', () => {
  const ctx = {
    priors: { 1: 4.5, 3: 5.2 },
    strength: { avg: 1.3, teams: new Map([['15', { gf: 1.8, ga: 0.9 }]]) },
    fixtures: new Map([['15', { home: true, rivalId: '20' }]]),
  };
  const json = JSON.parse(JSON.stringify(serializeXpContext(ctx, { week: 14, now: new Date('2026-11-20T10:00:00Z') })));
  const back = deserializeXpContext(json);
  expect(back.priors).toEqual(ctx.priors);
  expect(back.strength.teams.get('15')).toEqual({ gf: 1.8, ga: 0.9 });
  expect(back.fixtures.get('15')).toEqual({ home: true, rivalId: '20' });
  expect(back.meta).toEqual({ createdAt: '2026-11-20T10:00:00.000Z', week: 14 });
  expect(xpContextAgeDays(back.meta, new Date('2026-11-28T10:00:00Z'))).toBeCloseTo(8);
  expect(deserializeXpContext(null)).toBeNull();
});
