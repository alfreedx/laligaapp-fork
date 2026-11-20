/**
 * Avisos durante el día: notificación de Windows (y Telegram) 2 minutos antes de
 * que se abra una cláusula. Dos fuentes:
 *   - la lista del último informe (rivales, próximas 48 h), si los avisos están activados;
 *   - los avisos pedidos al bot con /clausula (siempre, y por Telegram si está configurado).
 * Solo funciona con la app abierta (o abierta por la tarea programada). Cada apertura se avisa una vez.
 */
import { loadSettings, loadState, readJson, writeJson } from './localStore';
import { buildTelegramClauseAlert } from './telegramMessage';

const NOTIFIED_FILE = 'clause-alerts.json';
const REMINDERS_FILE = 'clause-reminders.json'; // = botHandler.REMINDERS_FILE (sin importar el módulo del bot)
const MAX_LATE_MS = 12 * 3600 * 1000; // si el PC estaba dormido, avisar hasta 12 h tarde
export const CLAUSE_LEAD_MS = 2 * 60 * 1000; // avisar 2 min antes de la apertura

const M = (v) => (typeof v === 'number' ? `${(v / 1e6).toFixed(1).replace('.', ',')} M` : '—');

/** Aperturas que toca avisar ahora (función pura, testeable). */
export const dueClauseAlerts = (watch, notified, now = new Date(), leadMs = CLAUSE_LEAD_MS) =>
  (watch || []).filter((w) => {
    if (!w?.openAt) return false;
    const t = new Date(w.openAt).getTime();
    const key = `${w.id}|${w.openAt}`;
    return t - leadMs <= now.getTime() && now.getTime() - t <= MAX_LATE_MS && !notified.includes(key);
  });

/**
 * @param {object} [opts]
 * @param {number} [opts.leadMs]  antelación; la tarea programada usa más margen
 *                                porque abre la app unos minutos antes
 */
export const checkClauseAlerts = async ({ leadMs = CLAUSE_LEAD_MS } = {}) => {
  const ea = window.electronAPI?.automation;
  if (!ea) return 0;
  const settings = await loadSettings();
  const state = await loadState();
  const manual = await readJson(REMINDERS_FILE, []);
  const notified = await readJson(NOTIFIED_FILE, []);
  const watch = [
    ...manual.map((w) => ({ ...w, manual: true })),
    ...(settings.clauseAlertsEnabled ? (state.clauseWatch || []).filter((w) => !manual.some((m) => m.id === w.id && m.openAt === w.openAt)) : []),
  ];
  const now = new Date();
  const due = dueClauseAlerts(watch, notified, now, leadMs);
  const tg = window.electronAPI?.telegram;
  for (const w of due) {
    const minutesLeft = Math.ceil((new Date(w.openAt).getTime() - now.getTime()) / 60000);
    const title = minutesLeft > 0 ? `⏰ Cláusula en ${minutesLeft} min: ${w.name}` : `🔓 Cláusula abierta: ${w.name}`;
    const extra = [`cláusula ${M(w.clause)}`];
    if (typeof w.xp === 'number') extra.push(`xP ${w.xp.toFixed(1).replace('.', ',')}`);
    if (typeof w.gainNLaLiga === 'number') extra.push(`G.5d LaLiga ${w.gainNLaLiga >= 0 ? '+' : ''}${M(w.gainNLaLiga)}`);
    // eslint-disable-next-line no-await-in-loop
    await ea.notify(title, `${w.owner ? `De ${w.owner}` : 'Tuyo'} · ${extra.join(' · ')}`);
    // Los pedidos con /clausula siempre van a Telegram; los del informe, según Ajustes
    if (tg && settings.telegramEnabled && (w.manual || settings.telegramClauseAlerts)) {
      // eslint-disable-next-line no-await-in-loop
      await tg.sendMessage(buildTelegramClauseAlert(w, minutesLeft)).catch(() => {});
    }
    notified.push(`${w.id}|${w.openAt}`);
  }
  if (due.length) await writeJson(NOTIFIED_FILE, notified.slice(-300));
  return due.length;
};
