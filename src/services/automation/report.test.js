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

test('oportunidades: puja máxima rentable, rentabilidad y a quién mejoran de la alineación guardada', () => {
  const rival = { playerTeamId: 'rx', buyoutClause: 10e6, buyoutClauseLockedEndTime: null, playerMaster: pm('77', 'Crack', 3, { averagePoints: 12, lastStats: [{ weekNumber: 12, totalPoints: 12 }] }) };
  const teams = [data.teams[0], { ...data.teams[1], players: [rival] }];
  const trend = { valor: 10e6, valor1: 9.8e6, valor3: 9.4e6, diferencia1: 200e3, playProbability: 1 };
  const r = buildDailyReport({
    ...data, teams, myMoney: 50e6,
    currentLineupIds: new Set(['1', '3', '4', '5', '7', '8', '9', '10', '11', '12', '13']),
    resolveTrend: (p) => (p.id === '77' ? trend : null), trendsOk: true,
  }, { settings: { projectionDays: 5 } });
  const opp = r.json.oportunidadesDeportivas.find((o) => o.nombre === 'Crack');
  // valor en 5 días = 10 M + 5 × 200 K = 11 M → LaLiga +10 % = 12,1 M
  expect(opp.pujaMaxRentable).toBe(12_100_000);
  expect(opp.rentabilidadPct).toBeCloseTo(21);
  expect(opp.mejoraA).toMatch(/^Jugador(7|8|9|10)$/);
  expect(opp.mejoraPts).toBeGreaterThan(0);
});

test('ofertas: buena solo con ≥ +5 % sobre el valor; fuerte con motivo deportivo', () => {
  const myOffers = new Map([
    ['1', [{ money: 10.4e6 }]], // +4 % → no es buena
    ['7', [{ money: 11e6 }]], // +10 %, rinde → oportunidad (o fuerte si no está en el once)
    ['2', [{ money: 11e6 }]], // portero suplente → fuerte
  ]);
  const r = buildDailyReport({ ...data, myOffers }, { settings: { projectionDays: 5 } });
  const of = Object.fromEntries(r.json.ofertasRecibidas.map((o) => [o.jugador, o]));
  expect(of.Jugador1.recomendacion).toBeNull();
  expect(of.Jugador2.recomendacion).toBe('fuerte');
  expect(of.Jugador2.motivos).toContain('no está en tu once');
  expect(r.json.queHacerHoy.some((t) => t.startsWith('Vende a Jugador2'))).toBe(true);
  expect(r.json.queHacerHoy.some((t) => t.startsWith('Vende a Jugador1'))).toBe(false);
});

test('cláusulas bloqueadas 24 h antes del primer partido', () => {
  const kickoff = new Date(Date.now() + 5 * 3600 * 1000).toISOString();
  const teams = [data.teams[0], { ...data.teams[1], players: [{ ...data.teams[1].players[0], buyoutClauseLockedEndTime: null }] }];
  const r = buildDailyReport({ ...data, teams, matchday: { week: 13, kickoff } }, { settings: { projectionDays: 5 } });
  expect(r.json.clausulasBloqueadas.ahora).toBe(true);
  expect(r.json.inicioJornada).toBe(kickoff);
  expect(r.markdown).toContain('cláusulas bloqueadas hasta');
  // La cláusula del rival (abierta) no se puede pagar hasta el primer partido
  expect(r.clauseWatch.every((w) => w.openAt === kickoff)).toBe(true);
});
