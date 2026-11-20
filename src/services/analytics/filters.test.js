import { applyFilters, EMPTY_FILTERS, clauseOverValue, countActiveFilters } from './filters';

const now = new Date('2026-11-20T12:00:00Z');
const rows = [
  { id: 'a', owner: 'Ana', value: 10e6, clause: 10.5e6, clauseIsOpen: true, xp: 6, playProb: 0.9, status: 'ok', dailyGrowth: 100e3, clauseGainN: 2e6 },
  { id: 'b', owner: 'Bea', value: 20e6, clause: 30e6, clauseIsOpen: false, clauseOpenAt: '2026-11-21T06:00:00Z', xp: 2, playProb: 0.4, status: 'doubtful', dailyGrowth: -50e3, clauseGainN: -8e6 },
  { id: 'c', owner: 'Ana', value: 40e6, clause: 100e6, clauseIsOpen: false, clauseOpenAt: '2026-11-25T12:00:00Z', xp: 4, playProb: 0.7, status: 'ok', dailyGrowth: 0 },
  { id: 'd', owner: 'Bea', value: 5e6, clause: 6e6, isShielded: true, status: 'injured' },
];
const ids = (f, opts = {}) => applyFilters(rows, { ...EMPTY_FILTERS, ...f }, { tab: 'rivals', now, ...opts }).map((r) => r.id);

test('sin filtros devuelve todo', () => {
  expect(ids({})).toEqual(['a', 'b', 'c', 'd']);
  expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
  expect(countActiveFilters({ ...EMPTY_FILTERS, clause: 'open', affordable: true })).toBe(2);
});

test('estado de la cláusula', () => {
  expect(ids({ clause: 'open' })).toEqual(['a']);
  expect(ids({ clause: '24h' })).toEqual(['a', 'b']);
  expect(ids({ clause: '7d' })).toEqual(['a', 'b', 'c']);
  expect(ids({ clause: 'closed' })).toEqual(['b', 'c']);
  expect(ids({ clause: 'shielded' })).toEqual(['d']);
});

test('cláusula vs valor por rangos', () => {
  expect(clauseOverValue(rows[1])).toBeCloseTo(50);
  expect(ids({ clauseVsValue: 'lt10' })).toEqual(['a']);
  expect(ids({ clauseVsValue: '10-25' })).toEqual(['d']);
  expect(ids({ clauseVsValue: '50-100' })).toEqual(['b']);
  expect(ids({ clauseVsValue: 'gt100' })).toEqual(['c']);
});

test('valor, tendencia, deportivo, dueño y dinero', () => {
  expect(ids({ valueMin: '10', valueMax: '20,5' })).toEqual(['a', 'b']);
  expect(ids({ trend: 'up' })).toEqual(['a']);
  expect(ids({ trend: 'down' })).toEqual(['b']);
  expect(ids({ status: 'ok' })).toEqual(['a', 'c']);
  expect(ids({ status: 'issues' })).toEqual(['b', 'd']);
  expect(ids({ minXp: '4' })).toEqual(['a', 'c']);
  expect(ids({ minProb: '70' })).toEqual(['a', 'c']);
  expect(ids({ owner: 'Ana' })).toEqual(['a', 'c']);
  expect(ids({ affordable: true }, { myMoney: 25e6 })).toEqual(['a', 'd']);
  expect(ids({ profitable: true })).toEqual(['a']);
});
