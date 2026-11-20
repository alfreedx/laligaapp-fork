/**
 * Comandos del bot de Telegram (funciones puras):
 *   /clausula <jugador>  → cuándo se abre su cláusula, precio y aviso
 *   /avisos              → avisos de cláusula pendientes
 *   /ayuda
 * Solo lectura: nunca hace acciones en la cuenta.
 */
import { tgEscape } from './telegramMessage';
import { M, dt, isNum } from './reportFormat';

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** "/clausula@MiBot  Raphinha " → { command: 'clausula', args: 'Raphinha' } */
export const parseCommand = (text) => {
  const m = /^\/([a-zA-Z_áéíóúñ]+)(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(String(text || '').trim());
  if (!m) return null;
  const command = norm(m[1]);
  const alias = { clausulas: 'clausula', c: 'clausula', start: 'ayuda', help: 'ayuda' };
  return { command: alias[command] || command, args: (m[2] || '').trim() };
};

/**
 * Busca jugadores por nombre (sin acentos ni mayúsculas). Si alguno coincide
 * exactamente, devuelve solo esos; si no, los que contienen todas las palabras.
 */
export const findPlayers = (rows, query) => {
  const q = norm(query);
  if (!q) return [];
  const words = q.split(/\s+/);
  const names = (r) => [r.name, r.fullName].map(norm).filter(Boolean);
  const exact = rows.filter((r) => names(r).some((n) => n === q));
  if (exact.length) return exact;
  return rows.filter((r) => names(r).some((n) => words.every((w) => n.includes(w))));
};

const until = (iso, now) => {
  const ms = new Date(iso).getTime() - now.getTime();
  if (!(ms > 0)) return '';
  const h = Math.floor(ms / 3600e3);
  const min = Math.round((ms % 3600e3) / 60e3);
  return h >= 24 ? `en ${Math.floor(h / 24)} d ${h % 24} h` : h ? `en ${h} h ${min} min` : `en ${min} min`;
};

/** Texto de respuesta para un jugador (fila de rows.js con el bloqueo de jornada aplicado). */
export const clauseReply = (r, { myMoney = null, isMine = false, now = new Date(), reminder = false } = {}) => {
  const lines = [];
  lines.push(`${isMine ? '⭐' : '🔎'} <b>${tgEscape(r.name)}</b> (${tgEscape(r.position || '')}${r.team ? ` · ${tgEscape(r.team)}` : ''})${isMine ? ' · <b>es tuyo</b>' : r.owner ? ` · de ${tgEscape(r.owner)}` : ''}`);
  const over = isNum(r.clause) && isNum(r.value) && r.value > 0 ? (r.clause / r.value - 1) * 100 : null;
  lines.push(`Cláusula: <b>${tgEscape(M(r.clause))}</b> · valor ${tgEscape(M(r.value))}${isNum(over) ? ` (${over >= 0 ? '+' : ''}${Math.round(over)} %)` : ''}`);
  if (r.isShielded) lines.push('🛡️ Blindado: no se puede clausular.');
  else if (r.clauseIsOpen) lines.push('🟢 <b>Abierta ahora</b>.');
  else if (r.clauseLockedUntil) lines.push(`🔒 Bloqueada por la jornada: se podrá pagar al empezar el primer partido, <b>${tgEscape(dt(r.clauseOpenAt))}</b> (${tgEscape(until(r.clauseOpenAt, now))}).`);
  else if (r.clauseOpenAt) lines.push(`⏳ Se abre <b>${tgEscape(dt(r.clauseOpenAt))}</b> (${tgEscape(until(r.clauseOpenAt, now))}).`);
  if (!isMine && !r.isShielded && isNum(r.clause) && isNum(myMoney)) {
    lines.push(myMoney >= r.clause
      ? `💶 Te llega: tienes ${tgEscape(M(myMoney))}.`
      : `💶 No te llega: tienes ${tgEscape(M(myMoney))} (faltan ${tgEscape(M(r.clause - myMoney))}).`);
  }
  if (reminder) {
    lines.push('');
    lines.push('⏰ Te avisaré aquí <b>2 min antes</b> (si el PC está encendido o en suspensión).');
    lines.push('📅 Abre el archivo adjunto y pulsa «Añadir» para tener la alarma en el calendario del móvil.');
  }
  return lines.join('\n');
};

export const ambiguousReply = (matches, query) => [
  `Hay ${matches.length} jugadores que coinciden con «${tgEscape(query)}». ¿Cuál?`,
  ...matches.slice(0, 8).map((r) => `• <code>/clausula ${tgEscape(r.name)}</code> (${tgEscape(r.owner || 'tuyo')})`),
].join('\n');

export const HELP_TEXT = [
  '🤖 <b>Comandos</b>',
  '<code>/clausula nombre</code>: cuándo se abre la cláusula de un jugador de la liga, precio y si te llega. Te avisa 2 min antes y te manda un evento con alarma para el calendario.',
  '<code>/avisos</code>: avisos de cláusula pendientes.',
  '<code>/estado</code>: último informe, próxima jornada y errores recientes de la automatización.',
  '<i>Respondo mientras la app esté abierta en el PC (o al despertarse).</i>',
].join('\n');

export const remindersReply = (list, now = new Date()) => {
  const pending = (list || []).filter((w) => new Date(w.openAt) > now).sort((a, b) => new Date(a.openAt) - new Date(b.openAt));
  if (!pending.length) return 'No tienes avisos de cláusula pendientes. Usa <code>/clausula nombre</code>.';
  return ['⏰ <b>Avisos pendientes</b>', ...pending.map((w) => `• ${tgEscape(w.name)} (${tgEscape(w.owner || 'tuyo')}): ${tgEscape(dt(w.openAt))}`)].join('\n');
};

/** Estado de la automatización (último informe, jornada, avisos y errores recientes). */
export const statusReply = ({ state = {}, reminders = [], logLines = [], now = new Date() }) => {
  const lines = ['🩺 <b>Estado</b>'];
  lines.push(state.lastSuccessAt
    ? `📄 Último informe: ${tgEscape(dt(state.lastSuccessAt))}${state.lastEdition ? ` (${tgEscape(state.lastEdition)})` : ''}`
    : '📄 Aún no hay informes.');
  if (state.lastError) lines.push(`⚠️ ${tgEscape(state.lastError)}`);
  if (state.nextKickoff) lines.push(`⚽ Primer partido: ${tgEscape(dt(state.nextKickoff))}${state.lastMatchdaySummaryFor === state.nextKickoff ? ' (resumen enviado)' : ''}`);
  const pending = (reminders || []).filter((w) => new Date(w.openAt) > now).length;
  lines.push(`⏰ Avisos de cláusula pendientes: ${pending}`);
  const problems = (logLines || []).filter((l) => / (WARN|ERROR) /.test(l)).slice(-5);
  lines.push('');
  lines.push(problems.length ? '<b>Últimos problemas</b>' : '✅ Sin errores recientes en el registro.');
  problems.forEach((l) => lines.push(`<code>${tgEscape(l.slice(0, 160))}</code>`));
  return lines.join('\n');
};

// ------------------------------------------------------------ calendario
const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
// Líneas de más de 75 octetos se pliegan (RFC 5545); basta con cortar por caracteres con margen
const fold = (line) => {
  const out = [];
  let rest = line;
  while (rest.length > 60) { out.push(rest.slice(0, 60)); rest = ` ${rest.slice(60)}`; }
  out.push(rest);
  return out.join('\r\n');
};

/** Evento de calendario (.ics) con alarmas 2 min antes y en el momento. */
export const buildClauseIcs = ({ id, name, owner, clause, openAt, now = new Date() }) => {
  const start = new Date(openAt);
  const end = new Date(start.getTime() + 10 * 60 * 1000);
  const title = `Cláusula ${name}${owner ? ` (${owner})` : ''}`;
  const desc = `Se abre la cláusula de ${name}${owner ? ` (${owner})` : ''}: ${M(clause)}. Abre LaLiga Fantasy.`;
  const alarm = (trigger) => ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(title)}`, `TRIGGER:${trigger}`, 'END:VALARM'];
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LaLigaFantasyFork//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:clausula-${String(id).replace(/[^\w-]/g, '')}-${icsDate(start)}@laliga-fantasy-fork`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsText(`🔓 ${title}`)}`,
    `DESCRIPTION:${icsText(desc)}`,
    ...alarm('-PT2M'),
    ...alarm('PT0M'),
    'END:VEVENT', 'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
};

export const icsFileName = (name) => `clausula-${norm(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'jugador'}.ics`;
