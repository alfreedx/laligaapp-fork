import { buildLedger, getAcquisition, estimateMoney } from './ledger';
import { computeProfitability, growthRates } from './valuation';

const A = (activityTypeId, extra) => ({ activityTypeId, createdAt: extra.createdAt || '2026-10-01T10:00:00+02:00', ...extra });

describe('ledger', () => {
  const acts = [
    A(31, { user1Id: 1, playerMasterId: 10, amount: 5_000_000, createdAt: '2026-10-01T10:00:00+02:00' }),
    A(1, { user1Id: 2, user2Id: 1, playerMasterId: 10, amount: 8_000_000, createdAt: '2026-10-05T10:00:00+02:00' }),
    A(33, { user1Id: 2, playerMasterId: 10, amount: 9_000_000, createdAt: '2026-10-09T10:00:00+02:00' }),
    A(31, { user1Id: 2, playerMasterId: 11, amount: 3_000_000, createdAt: '2026-10-10T10:00:00+02:00' }),
    A(6, { user1Id: 1, amount: 2_000_000, createdAt: '2026-10-11T10:00:00+02:00' }),
  ];
  // Orden desordenado a propósito: el ledger debe ordenar por fecha
  const L = buildLedger([...acts].reverse());

  test('precio de compra del dueño actual', () => {
    expect(getAcquisition(L, 11, 2)).toMatchObject({ price: 3_000_000, via: 'mercado' });
    expect(getAcquisition(L, 11, 1)).toBeNull();
    expect(getAcquisition(L, 10, 2)).toBeNull(); // vendido a LaLiga
  });

  test('ventas con ganancia efectiva', () => {
    const s1 = L.sales.find((s) => s.managerId === '1');
    expect(s1).toMatchObject({ buyPrice: 5_000_000, sellPrice: 8_000_000, profit: 3_000_000, soldTo: '2' });
    const s2 = L.sales.find((s) => s.managerId === '2');
    expect(s2).toMatchObject({ buyPrice: 8_000_000, sellPrice: 9_000_000, profit: 1_000_000, soldTo: 'LaLiga' });
  });

  test('dinero estimado', () => {
    // m1: 100 − 5 + 8 + 2 = 105 M ; m2: 100 − 8 + 9 − 3 = 98 M
    expect(estimateMoney(L, 1).estimated).toBe(105_000_000);
    expect(estimateMoney(L, 2).estimated).toBe(98_000_000);
    expect(estimateMoney(L, 2, { calibration: -10_000_000 }).calibrated).toBe(88_000_000);
  });
});

describe('valuation', () => {
  const trend = { valor: 10_000_000, valor1: 9_800_000, valor3: 9_400_000, valor7: 9_300_000, diferencia1: 200_000 };

  test('ritmos de crecimiento', () => {
    expect(growthRates(trend)).toEqual({ daily: 200_000, avg3: 200_000, avg7: 100_000 });
  });

  test('columnas del Excel', () => {
    const r = computeProfitability({ buyPrice: 9_000_000, value: 10_000_000, trend });
    expect(r.laLigaMax).toBeCloseTo(11_000_000);
    expect(r.latentGain).toBe(1_000_000);
    expect(r.latentGainLaLiga).toBeCloseTo(2_000_000);
    expect(r.valueN).toBe(11_000_000); // 10 M + 5 × 200 K
    expect(r.laLigaN).toBeCloseTo(12_100_000);
    expect(r.gainN).toBe(2_000_000);
    expect(r.gainNLaLiga).toBeCloseTo(3_100_000);
  });

  test('sin precio de compra no inventa ganancias', () => {
    const r = computeProfitability({ buyPrice: null, value: 10_000_000, trend: null });
    expect(r.latentGain).toBeNull();
    expect(r.valueN).toBeNull();
  });
});
