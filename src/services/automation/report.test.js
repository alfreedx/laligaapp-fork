import { buildDailyReport } from './report';
import { SM, K } from './reportFormat';
import { buildLedger } from '../analytics/ledger';

test('formato: sin "−0,0 M" y tendencias grandes en millones', () => {
  expect(SM(-20_000)).toBe('0,0 M');
  expect(SM(7_250_000)).toBe('+7,3 M');
  expect(SM(-1_500_000)).toBe('−1,5 M');
  expect(K(1_293_000)).toBe('+1,29 M');
  expect(K(-53_000)).toBe('−53K');
});

const pm = (id, name, positionId, extra = {}) => ({
  id, name, nickname: name, positionId, marketValue: 10e6, points: 50, averagePoints: 5, playerStatus: 'ok',
  lastStats: [{ weekNumber: 12, totalPoints: 6 }], ...extra,
});
const squadPlayers = [
  [1, 1], [2, 1], [3, 2], [4, 2], [5, 2], [6, 2], [7, 3], [8, 3], [9, 3], [10, 3], [11, 4], [12, 4], [13, 4], [14, 5],
].map(([id, pos]) => ({ playerTeamId: `pt${id}`, buyoutClause: 12e6, playerMaster: pm(String(id), `Jugador${id}`, pos) }));

const data = {
  myTeamId: 't1',
  myTeam: { teamId: 't1', managerId: 'm1', managerName: 'Yo', teamValue: 140e6, teamPoints: 500, position: 1, players: squadPlayers },
  teams: [
    { teamId: 't1', managerId: 'm1', managerName: 'Yo', teamValue: 140e6, teamPoints: 500, position: 1, players: squadPlayers },
    { teamId: 't2', managerId: 'm2', managerName: '<img src=x onerror=alert(1)>', teamValue: 50e6, teamPoints: 400, position: 2,
      players: [{ playerTeamId: 'r1', buyoutClause: 5e6, playerMaster: pm('99', 'Rival<script>', 4) }] },
  ],
  myMoney: 30e6,
  market: [],
  ledger: buildLedger([]),
  ownerByPlayer: new Map(),
  myOffers: new Map(),
  resolveTrend: () => null,
  trendsOk: false,
  week: 13,
  weekInfo: { openingWeekDate: '2030-01-01T20:00:00Z' },
};

test('genera markdown, HTML visual y JSON; escapa nombres de la API', () => {
  const r = buildDailyReport(data, { settings: { projectionDays: 5, initialMoney: 100e6 }, leagueName: 'Test' });
  expect(r.markdown).toContain('## 🎯 Qué hacer hoy');
  expect(r.markdown).toContain('## 🧠 Tu once');
  expect(r.html).toMatch(/^<!doctype html>/);
  expect(r.html).toContain('A4 portrait');
  expect(r.html).not.toContain('<script>');
  expect(r.html).not.toContain('<img src=x');
  expect(r.html).toContain('&lt;img src=x');
  expect(r.json.onceRecomendado.titulares).toHaveLength(11);
  expect(r.json.queHacerHoy.length).toBeGreaterThan(0);
});
