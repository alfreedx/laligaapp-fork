import { forecastPoints, recentForm, bestLineup } from './forecast';
import { teamStrength } from './xpModel';

describe('forecastPoints', () => {
  const pm = {
    positionId: 3,
    playerStatus: 'ok',
    averagePoints: 6,
    lastStats: [
      { weekNumber: 10, totalPoints: 2 },
      { weekNumber: 11, totalPoints: 9 },
      { weekNumber: 12, totalPoints: 9 },
      { weekNumber: 13, totalPoints: 12 },
    ],
  };

  test('forma = media de las 3 últimas jornadas', () => {
    expect(recentForm(pm)).toBe(10);
  });

  test('xP v2: titularidad de futbolfantasy × puntos por titularidad (sin casa/fuera)', () => {
    const r = forecastPoints(pm, { playProbability: 0.9, nextIsHome: true, nextRival: 'Celta' }, null);
    expect(r.probSource).toBe('futbolfantasy');
    expect(r.playProb).toBe(0.9);
    expect(r.nextRival).toBe('Celta');
    // Sin minutos en lastStats: jugó si puntuó → 4 titularidades; encogida a la media por defecto (5)
    expect(r.ptsIfStarts).toBeGreaterThan(5);
    expect(r.ptsIfStarts).toBeLessThan(10);
    expect(r.xp).toBeGreaterThan(0.9 * r.ptsIfStarts - 1e-9);
    expect(r.rivalFactor).toBe(1);
  });

  test('el rival del calendario modifica el xP (contexto de liga)', () => {
    const cal = { 1: [{ localId: 'R', visitorId: 'X', localScore: 0, visitorScore: 5 }] };
    const ctx = { priors: { 3: 5 }, strength: teamStrength(cal, 2), fixtures: new Map([['T', { home: true, rivalId: 'R' }]]) };
    const conTeam = { ...pm, team: { id: 'T' } };
    const a = forecastPoints(conTeam, { playProbability: 0.9 }, ctx);
    const b = forecastPoints(conTeam, { playProbability: 0.9 }, { ...ctx, fixtures: new Map() });
    expect(a.rivalFactor).toBeGreaterThan(1); // R encaja mucho → bueno para un medio
    expect(a.xp).toBeGreaterThan(b.xp);
    expect(a.nextIsHome).toBe(true);
  });

  test('entrenador: media y forma', () => {
    const r = forecastPoints({ ...pm, positionId: 5 }, null, null);
    expect(r.xp).toBeCloseTo(0.6 * 6 + 0.4 * 10);
    expect(r.probSource).toBe('entrenador');
  });

  test('lesionado → 0 aunque futbolfantasy diga otra cosa', () => {
    expect(forecastPoints({ ...pm, playerStatus: 'injured' }, { playProbability: 0.8 }).xp).toBe(0);
  });
});

describe('bestLineup', () => {
  const mk = (id, positionId, xp) => ({ id: String(id), name: `p${id}`, positionId, xp });
  const squad = [
    mk(1, 1, 5), mk(2, 1, 3),
    mk(3, 2, 6), mk(4, 2, 5), mk(5, 2, 4), mk(6, 2, 1), mk(7, 2, 0.5),
    mk(8, 3, 9), mk(9, 3, 8), mk(10, 3, 2), mk(11, 3, 1),
    mk(12, 4, 7), mk(13, 4, 6), mk(14, 4, 5.5), mk(15, 4, 5),
    mk(16, 5, 3),
  ];

  test('elige la formación con más puntos esperados y capitán = máximo xP', () => {
    const r = bestLineup(squad);
    expect(r.starters).toHaveLength(11);
    expect(r.captain.id).toBe('8');
    expect(r.coach.id).toBe('16');
    // 4 delanteros buenos → 4-2-4 debería ganar
    expect(r.formation).toBe('4-2-4');
  });
});
