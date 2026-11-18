/**
 * Mensajes de Telegram (parse_mode HTML). Todo texto de la API se escapa.
 * Funciones puras.
 */
import { EDITIONS } from './schedule';
import { M, SM, dt, isNum } from './reportFormat';

export const tgEscape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// **negrita** → <b>, sobre texto ya escapado
const rich = (s) => tgEscape(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

/** Resumen del informe: cabecera, cifras clave y "Qué hacer hoy". */
export const buildTelegramSummary = (model) => {
  const ed = EDITIONS[model.edition] || EDITIONS.apertura;
  const k = model.kpis;
  const lines = [];
  lines.push(`${ed.icon} <b>Informe Fantasy · ${tgEscape(ed.label)}</b>`);
  lines.push(`${tgEscape(model.now.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }))} · ${tgEscape(model.now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }))}`);
  lines.push('');
  lines.push(`🏆 ${tgEscape(k.rank || '?')}º · ${tgEscape(k.points)} pts${isNum(k.gap) ? ` (${k.gap >= 0 ? '+' : ''}${tgEscape(k.gap)} vs ${tgEscape(k.closest)})` : ''}`);
  lines.push(`💶 Saldo <b>${tgEscape(M(k.money))}</b> · Equipo ${tgEscape(M(k.teamValue, 0))} · LaLiga hoy ${tgEscape(SM(k.gainLaLiga))}`);
  if (model.weekStart) lines.push(`📅 Jornada ${tgEscape(model.week)} empieza ${tgEscape(dt(model.weekStart))}`);
  lines.push('');
  if (model.edition === 'cierre') lines.push('<i>Las ofertas y pujas se resuelven a las 19:00: actúa antes.</i>');
  else lines.push('<i>Mercado nuevo. Los valores se actualizan de madrugada: las proyecciones usan los de hoy.</i>');
  lines.push('');
  lines.push('🎯 <b>Qué hacer</b>');
  model.actions.forEach((a) => lines.push(`${tgEscape(a.icon)} ${rich(a.text)}`));
  return lines.join('\n');
};

export const buildTelegramClauseAlert = (w) => {
  const parts = [`cláusula <b>${tgEscape(M(w.clause))}</b>`];
  if (isNum(w.xp)) parts.push(`xP ${tgEscape(w.xp.toFixed(1).replace('.', ','))}`);
  if (isNum(w.gainNLaLiga)) parts.push(`gana en 5d ${tgEscape(SM(w.gainNLaLiga))}`);
  return `🔓 <b>Cláusula abierta: ${tgEscape(w.name)}</b>\nDe ${tgEscape(w.owner)} · ${parts.join(' · ')}`;
};

export const buildTelegramError = (message) => `⚠️ <b>Informe Fantasy: error</b>\n${tgEscape(message)}\nAbre la app en el PC para revisarlo.`;
