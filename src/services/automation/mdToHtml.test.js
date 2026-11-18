import { markdownToHtml, reportHtmlDocument } from './mdToHtml';

test('convierte títulos, listas, tablas y estilos', () => {
  const html = markdownToHtml([
    '# Título',
    '## Sección',
    '- uno **dos**',
    '| A | B |',
    '| --- | --- |',
    '| x | +1,5 |',
    '| y | -2,0 |',
    '_nota al pie_',
  ].join('\n'));
  expect(html).toContain('<h1>Título</h1>');
  expect(html).toContain('<h2>Sección</h2>');
  expect(html).toContain('<li>uno <strong>dos</strong></li>');
  expect(html).toContain('<th>A</th>');
  expect(html).toContain('<td class="pos">+1,5</td>');
  expect(html).toContain('<td class="neg">-2,0</td>');
  expect(html).toContain('<em>nota al pie</em>');
});

test('escapa HTML de nombres que vienen de la API', () => {
  const html = markdownToHtml('| <script>alert(1)</script> | ok |\n| --- | --- |\n| a<b | c |');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('a&lt;b');
});

test('documento completo con estilos de impresión', () => {
  const doc = reportHtmlDocument('# Hola');
  expect(doc).toMatch(/^<!doctype html>/);
  expect(doc).toContain('A4 landscape');
});
