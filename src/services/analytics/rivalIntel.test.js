import { valueDaysAgo, buildBidStats, recentActivity, clauseRaisesBetween, suggestedBid } from './rivalIntel';

const trend = { valor: 11e6, valor1: 10.5e6, valor2: 10e6, valor3: 10e6, valor7: 9e6, valor14: 8e6, valor30: 6e6 };

test('interpola el valor en una fecha pasada', () => {
  expect(valueDaysAgo(trend, 0)).toBe(11e6);
  expect(valueDaysAgo(trend, 0.5)).toBeCloseTo(10.75e6);
  expect(valueDaysAgo(trend, 5)).toBeCloseTo(9.5e6);
  expect(valueDaysAgo(trend, 40)).toBeNull();
});

test('sobrepuja por manager y puja sugerida', () => {
  const now = new Date('2026-11-18T20:00:00Z');
  const day = (d) => new Date(now.getTime() - d * 86400000).toISOString();
  const ledger = {
    purchases: [
      { managerId: '1', playerId: 'a', price: 11e6, date: day(1), via: 'mercado' },  // valor 10,5 → +4,76 %
      { managerId: '1', playerId: 'a', price: 12e6, date: day(2), via: 'mercado' },  // valor 10 → +20 %
      { managerId: '2', playerId: 'a', price: 10e6, date: day(3), via: 'mercado' },  // 0 %
      { managerId: '2', playerId: 'a', price: 99e6, date: day(3), via: 'manager' },  // ignorada (no es puja)
      { managerId: '2', playerId: 'a', price: 9e6, date: day(45), via: 'mercado' },  // ignorada (> 30 días)
    ],
    sales: [{ managerId: '2', sellPrice: 5e6, sellDate: day(2) }],
  };
  const stats = buildBidStats({ ledger, trendById: () => trend, now });
  expect(stats.overall.n).toBe(3);
  expect(stats.byManager.get('1').max).toBeCloseTo(20);
  expect(stats.byManager.get('2').median).toBeCloseTo(0);
  expect(suggestedBid(10e6, stats.overall)).toBeNull(); // < 5 muestras: sin sugerencia

  const act = recentActivity(ledger, { days: 7, now });
  expect(act.get('1')).toMatchObject({ buys: 2, buySpend: 23e6 });
  expect(act.get('2')).toMatchObject({ buys: 2, sells: 1, sellIncome: 5e6 });
});

test('detecta subidas de cláusula entre capturas', () => {
  const prev = { teams: [{ managerId: '1', players: [{ id: 'x', clause: 10e6 }, { id: 'y', clause: 5e6 }] }] };
  const curr = { teams: [{ managerId: '1', players: [{ id: 'x', clause: 14e6 }, { id: 'y', clause: 5e6 }] }] };
  const r = clauseRaisesBetween(prev, curr);
  expect(r.get('1')).toEqual({ raises: 1, increase: 4e6, estimatedCost: 2e6 });
});
