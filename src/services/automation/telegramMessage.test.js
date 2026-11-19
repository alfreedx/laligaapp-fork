import { buildTelegramSummary, buildTelegramClauseAlert, tgEscape } from './telegramMessage';

const model = {
  edition: 'cierre',
  now: new Date('2026-11-19T18:50:00'),
  week: 13,
  weekStart: '2026-11-20T21:00:00',
  kpis: { rank: 1, points: 780, gap: 44, closest: 'Rival <b>', money: 58e6, teamValue: 607e6, gainLaLiga: 31.6e6 },
  actions: [{ icon: '💰', text: 'Acepta la oferta por **Pepelu<script>**' }],
};

test('resumen con edición, cifras y acciones escapadas', () => {
  const t = buildTelegramSummary(model);
  expect(t).toContain('Antes del cierre');
  expect(t).toContain('19:00');
  expect(t).toContain('<b>Pepelu&lt;script&gt;</b>');
  expect(t).toContain('Rival &lt;b&gt;');
  expect(t).not.toContain('<script>');
  expect(buildTelegramSummary({ ...model, edition: 'apertura' })).toContain('Mercado nuevo');
});

test('aviso de cláusula', () => {
  const t = buildTelegramClauseAlert({ name: 'Aubameyang', owner: 'a&b', clause: 73.7e6, xp: 2.3, gainNLaLiga: 17.8e6 });
  expect(t).toContain('Aubameyang');
  expect(t).toContain('a&amp;b');
  expect(t).toContain('73,7 M');
  expect(t).toContain('Cláusula abierta');
  expect(buildTelegramClauseAlert({ name: 'X', owner: 'Y', clause: 1e6 }, 2)).toContain('Cláusula en 2 min');
  expect(tgEscape('<x>')).toBe('&lt;x&gt;');
});
