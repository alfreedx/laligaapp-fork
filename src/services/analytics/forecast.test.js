import { forecastPoints, recentForm, bestLineup, HOME_FACTOR } from './forecast';

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

  test('xP combina media, forma, casa y probabilidad', () => {
    const r = forecastPoints(pm, { playProbability: 0.9, nextIsHome: true, nextRival: 'Celta' });
    // base = 0.6·6 + 0.4·10 = 7.6
    expect(r.xp).toBeCloseTo(7.6 * HOME_FACTOR * 0.9);
    expect(r.probSource).toBe('futbolfantasy');
    expect(r.nextRival).toBe('Celta');
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
