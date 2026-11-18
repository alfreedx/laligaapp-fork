/**
 * Conversor mínimo Markdown → HTML para el informe diario (solo el
 * subconjunto que genera report.js: títulos, citas, listas, tablas,
 * negrita/cursiva). Todo el texto se escapa: nombres de jugadores y
 * managers vienen de la API y nunca se interpretan como HTML.
 */

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const inline = (s) => escapeHtml(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[\s(])_(.+?)_(?=$|[\s).,:;])/g, '$1<em>$2</em>')
  .replace(/`([^`]+)`/g, '<code>$1</code>');

// Celda numérica con signo → color (verde sube / rojo baja)
const cellClass = (raw) => {
  const t = raw.trim();
  if (/^\+\d/.test(t)) return ' class="pos"';
  if (/^[-−]\d/.test(t)) return ' class="neg"';
  if (/^[\d.,]+( ?%| ?K| M)?\*?$/.test(t)) return ' class="num"';
  return '';
};

const splitRow = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());

export const markdownToHtml = (md) => {
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const [head, sep, ...body] = rows;
      const hasHeader = sep && /^\s*\|[\s:|-]+\|\s*$/.test(sep);
      const bodyRows = hasHeader ? body : rows.slice(1);
      out.push('<div class="tw"><table>');
      out.push(`<thead><tr>${splitRow(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead>`);
      out.push(`<tbody>${bodyRows.map((r) => `<tr>${splitRow(r).map((c) => `<td${cellClass(c)}>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody>`);
      out.push('</table></div>');
      continue;
    }
    if (/^- /.test(line)) {
      const items = [];
      while (i < lines.length && /^- /.test(lines[i])) { items.push(lines[i].slice(2)); i++; }
      out.push(`<ul>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</ul>`);
      continue;
    }
    if (/^# /.test(line)) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (/^## /.test(line)) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (/^> /.test(line)) out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    else if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  return out.join('\n');
};

const CSS = `
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", "Segoe UI Emoji", Roboto, Arial, sans-serif; font-size: 9.5pt; color: #1f2937; margin: 0; line-height: 1.35; }
  h1 { font-size: 17pt; margin: 0 0 2px; color: #111827; }
  h2 { font-size: 12pt; margin: 14px 0 6px; padding: 4px 8px; background: #eef2ff; border-left: 4px solid #4f46e5; border-radius: 3px; page-break-after: avoid; }
  p { margin: 3px 0; }
  blockquote { margin: 6px 0; padding: 6px 10px; background: #f9fafb; border-left: 3px solid #9ca3af; color: #4b5563; font-size: 8.5pt; }
  ul { margin: 4px 0 4px 18px; padding: 0; }
  li { margin: 2px 0; }
  em { color: #6b7280; }
  code { background: #f3f4f6; padding: 0 3px; border-radius: 3px; }
  .tw { width: 100%; overflow: hidden; }
  table { border-collapse: collapse; width: 100%; margin: 4px 0 6px; font-size: 8.3pt; page-break-inside: auto; }
  tr { page-break-inside: avoid; }
  thead { display: table-header-group; }
  th { background: #f3f4f6; text-align: left; font-weight: 600; padding: 3px 5px; border-bottom: 1px solid #d1d5db; white-space: nowrap; }
  td { padding: 2.5px 5px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #fafafa; }
  td.num, td.pos, td.neg { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.pos { color: #047857; }
  td.neg { color: #b91c1c; }
  strong { color: #111827; }
`;

/** Documento HTML completo listo para imprimir a PDF. */
export const reportHtmlDocument = (md, title = 'Informe LaLiga Fantasy') => `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${CSS}</style></head>
<body>${markdownToHtml(md)}</body></html>`;
