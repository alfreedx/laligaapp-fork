import { buildHistory, positionPriors, predictV2, teamStrength, rivalFactor } from './xpModel';
import { runRetroBacktest, spearman, bootstrapCI } from './retroBacktest';

const st = (week, pts, mins) => ({ weekNumber: week, totalPoints: pts, stats: { mins_played: [mins, 0] } });

test('historia: minutos [valor, puntos], titular ≥ 60\', sin jornadas duplicadas', () => {
  const h = buildHistory({ playerStats: [st(2, 3, 20), st(1, 8, 90), st(3, 0, 0), st(3, 0, 0)] });
  expect(h.map((x) => [x.week, x.started, x.played])).toEqual([[1, true, true], [2, false, true], [3, false, false]]);
});

test('predicción: sin fuga, encogida a la media de su posición y con titular/suplente', () => {
  const history = buildHistory({ playerStats: [st(1, 10, 90), st(2, 10, 90), st(3, 10, 90), st(4, 30, 90)] });
  const priors = { 3: 4 };
  const p = predictV2({ history, positionId: 3, beforeWeek: 4, priors });
  // Solo J1–J3 (10 pts): (n·10 + 4·4)/(n+4) con n≈2,57 (pesos 1 + 0,85 + 0,72) → ~6,3
  expect(p.ptsStart).toBeGreaterThan(6);
  expect(p.ptsStart).toBeLessThan(7);
  expect(p.pStart).toBeCloseTo(1);
  expect(p.xp).toBeCloseTo(p.ptsStart);
  // Lesionado → 0; futbolfantasy manda si hay dato
  expect(predictV2({ history, positionId: 3, beforeWeek: 4, priors, status: 'injured' }).xp).toBe(0);
  expect(predictV2({ history, positionId: 3, beforeWeek: 4, priors, pStart: 0.5 }).pStart).toBe(0.5);
});

test('suplente habitual: poca probabilidad de titular y puntos de banquillo', () => {
  const history = buildHistory({ playerStats: [st(1, 1, 15), st(2, 2, 20), st(3, 0, 0), st(4, 1, 10)] });
  const p = predictV2({ history, positionId: 4, beforeWeek: 5, priors: { 4: 5 } });
  expect(p.pStart).toBeLessThan(0.05);
  expect(p.pSub).toBeGreaterThan(0.5);
  expect(p.xp).toBeLessThan(2);
});

test('fuerza de equipos y factor rival acotado', () => {
  const cal = { 1: [{ localId: 'A', visitorId: 'B', localScore: 5, visitorScore: 0 }], 2: [{ localId: 'B', visitorId: 'A', localScore: 0, visitorScore: 4 }] };
  const s = teamStrength(cal, 3);
  expect(s.teams.get('A').gf).toBeGreaterThan(s.teams.get('B').gf);
  // Delantero contra B (encaja mucho) → sube; portero contra A (marca mucho) → baja
  expect(rivalFactor({ positionId: 4, rivalId: 'B', strength: s, weight: 0.5 })).toBeGreaterThan(1);
  expect(rivalFactor({ positionId: 1, rivalId: 'A', strength: s, weight: 0.5 })).toBeCloseTo(0.85);
  expect(rivalFactor({ positionId: 4, rivalId: 'B', strength: s, weight: 0 })).toBe(1);
  expect(positionPriors([{ positionId: 2, history: buildHistory({ playerStats: [st(1, 6, 90), st(2, 2, 90)] }) }], 2)).toEqual({ 2: 6 });
});

test('spearman y bootstrap', () => {
  expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
  expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
  const ci = bootstrapCI([-1, -1.2, -0.8, -1.1, -0.9]);
  expect(ci.hi).toBeLessThan(0);
});

test('backtest retroactivo con datos sintéticos: el modelo nuevo no pierde frente al actual', () => {
  // 2 equipos reales; jugadores "fijos" (titulares que puntúan estable) y "rotan"
  const players = [];
  const squadIds = [];
  const pos = [1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 1, 2, 3, 4];
  pos.forEach((positionId, i) => {
    const regular = i < 11;
    const stats = [];
    for (let w = 1; w <= 8; w++) {
      const starts = regular || w % 3 === 0;
      stats.push(st(w, starts ? 4 + (i % 4) + (w % 2) : 1, starts ? 90 : 15));
    }
    const id = `p${i}`;
    players.push({ id, name: id, positionId, teamId: i % 2 ? 'A' : 'B', history: buildHistory({ playerStats: stats }) });
    squadIds.push(id);
  });
  // Rellenar hasta ≥ 20 jugadores evaluables con una copia
  players.push(...players.map((p) => ({ ...p, id: `${p.id}b` })));
  const calendarByWeek = {};
  for (let w = 1; w <= 8; w++) calendarByWeek[w] = [{ localId: 'A', visitorId: 'B', localScore: 1, visitorScore: 1 }];
  const r = runRetroBacktest({ players, calendarByWeek, squads: [squadIds], weeks: [4, 5, 6, 7, 8] });
  expect(r.weeks).toEqual([4, 5, 6, 7, 8]);
  expect(r.summary.v2.regret).toBeLessThanOrEqual(r.summary.actual.regret + 1e-9);
  expect(r.summary.v2.mae).toBeGreaterThan(0);
});
