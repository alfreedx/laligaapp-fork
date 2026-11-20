/**
 * Atiende los comandos que llegan al bot de Telegram (los recibe el proceso
 * principal, solo del chat configurado). Solo lectura: consulta la liga y
 * responde; nunca hace acciones en la cuenta.
 */
import { loadClauseData } from './dataLoader';
import { readJson, writeJson } from './localStore';
import { buildSquadRows, buildRivalRows } from '../analytics/rows';
import { applyClauseLock } from '../analytics/matchday';
import {
  parseCommand, findPlayers, clauseReply, ambiguousReply, remindersReply, buildClauseIcs, icsFileName, HELP_TEXT,
} from './botCommands';
import { tgEscape } from './telegramMessage';

export const REMINDERS_FILE = 'clause-reminders.json';
const KEEP_AFTER_MS = 12 * 3600 * 1000;
export const REMINDER_TASK_LEAD_MS = 3 * 60 * 1000; // la tarea abre la app 3 min antes

export const loadReminders = async () => readJson(REMINDERS_FILE, []);

/** Guarda los avisos y reprograma la tarea de Windows que despierta el PC. */
export const saveReminders = async (list, now = new Date()) => {
  const kept = (list || []).filter((w) => new Date(w.openAt).getTime() > now.getTime() - KEEP_AFTER_MS).slice(-30);
  await writeJson(REMINDERS_FILE, kept);
  const times = kept
    .map((w) => new Date(w.openAt).getTime() - REMINDER_TASK_LEAD_MS)
    .filter((t) => t > now.getTime())
    .map((t) => new Date(t).toISOString());
  const ea = window.electronAPI?.automation;
  if (ea?.scheduleClauseReminders) await ea.scheduleClauseReminders(times).catch(() => null);
  return kept;
};

const send = (text) => window.electronAPI.telegram.sendMessage(text);

const clauseCommand = async (query, ctx) => {
  if (!query) return send('Escribe el nombre del jugador, por ejemplo: <code>/clausula Raphinha</code>');
  await send(`🔎 Buscando a «${tgEscape(query)}»…`);
  const data = await loadClauseData(ctx);
  const now = new Date();
  const lock = (r) => applyClauseLock(r, data.matchday?.kickoff, now);
  const mine = buildSquadRows({ team: data.myTeam }).map((r) => ({ ...lock(r), isMine: true }));
  const rivals = buildRivalRows({ teams: data.teams, myTeamId: data.myTeamId }).map(lock);
  const matches = findPlayers([...mine, ...rivals], query);
  if (!matches.length) return send(`No encuentro a «${tgEscape(query)}» en ninguna plantilla de la liga (los jugadores libres no tienen cláusula).`);
  if (matches.length > 1) return send(ambiguousReply(matches, query));

  const r = matches[0];
  const future = !r.isShielded && !r.clauseIsOpen && r.clauseOpenAt && new Date(r.clauseOpenAt) > now;
  if (future) {
    const list = (await loadReminders()).filter((w) => w.id !== r.id);
    list.push({ id: r.id, name: r.name, owner: r.isMine ? null : r.owner, openAt: r.clauseOpenAt, clause: r.clause, manual: true });
    await saveReminders(list, now);
  }
  await send(clauseReply(r, { myMoney: data.myMoney, isMine: r.isMine, now, reminder: !!future }));
  if (future) {
    const ics = buildClauseIcs({ id: r.id, name: r.name, owner: r.isMine ? null : r.owner, clause: r.clause, openAt: r.clauseOpenAt, now });
    await window.electronAPI.telegram.sendFile(icsFileName(r.name), ics, `📅 Alarma: cláusula de ${tgEscape(r.name)}`);
  }
  return true;
};

/**
 * @param {{ text: string, date?: number }} msg   mensaje de Telegram (date en segundos)
 * @param {{ leagueId, user }} ctx
 */
export const handleBotMessage = async (msg, ctx) => {
  if (!window.electronAPI?.telegram) return;
  const late = msg.date && Date.now() - msg.date * 1000 > 10 * 60 * 1000;
  if (late) await send('<i>Respondo con retraso: el PC estaba apagado o dormido.</i>');
  const cmd = parseCommand(msg.text);
  try {
    if (!cmd || cmd.command === 'ayuda') return await send(HELP_TEXT);
    if (cmd.command === 'clausula') return await clauseCommand(cmd.args, ctx);
    if (cmd.command === 'avisos') return await send(remindersReply(await loadReminders()));
    return await send(`No conozco /${tgEscape(cmd.command)}.\n\n${HELP_TEXT}`);
  } catch (error) {
    return send(`⚠️ No he podido consultarlo: ${tgEscape(error.message)}`);
  }
};
