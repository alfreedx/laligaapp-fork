/**
 * Avisos durante el día: notificación de Windows cuando se abre la cláusula
 * de un jugador rival (lista generada por el trabajo diario, próximas 48 h).
 * Solo funciona con la app abierta. Cada apertura se avisa una vez.
 */
import { loadSettings, loadState, readJson, writeJson } from './localStore';
import { buildTelegramClauseAlert } from './telegramMessage';

const NOTIFIED_FILE = 'clause-alerts.json';
const MAX_LATE_MS = 12 * 3600 * 1000; // si el PC estaba dormido, avisar hasta 12 h tarde

const M = (v) => (typeof v === 'number' ? `${(v / 1e6).toFixed(1).replace('.', ',')} M` : '—');

/** Aperturas que toca avisar ahora (función pura, testeable). */
export const dueClauseAlerts = (watch, notified, now = new Date()) =>
  (watch || []).filter((w) => {
    if (!w?.openAt) return false;
    const t = new Date(w.openAt).getTime();
    const key = `${w.id}|${w.openAt}`;
    return t <= now.getTime() && now.getTime() - t <= MAX_LATE_MS && !notified.includes(key);
  });

export const checkClauseAlerts = async () => {
  const ea = window.electronAPI?.automation;
  if (!ea) return 0;
  const settings = await loadSettings();
  if (!settings.clauseAlertsEnabled) return 0;
  const state = await loadState();
  const notified = await readJson(NOTIFIED_FILE, []);
  const due = dueClauseAlerts(state.clauseWatch, notified);
  for (const w of due) {
    const extra = [`cláusula ${M(w.clause)}`];
    if (typeof w.xp === 'number') extra.push(`xP ${w.xp.toFixed(1).replace('.', ',')}`);
    if (typeof w.gainNLaLiga === 'number') extra.push(`G.5d LaLiga ${w.gainNLaLiga >= 0 ? '+' : ''}${M(w.gainNLaLiga)}`);
    // eslint-disable-next-line no-await-in-loop
    await ea.notify(`🔓 Cláusula abierta: ${w.name}`, `De ${w.owner} · ${extra.join(' · ')}`);
    if (settings.telegramEnabled && settings.telegramClauseAlerts && window.electronAPI?.telegram) {
      // eslint-disable-next-line no-await-in-loop
      await window.electronAPI.telegram.sendMessage(buildTelegramClauseAlert(w)).catch(() => {});
    }
    notified.push(`${w.id}|${w.openAt}`);
  }
  if (due.length) await writeJson(NOTIFIED_FILE, notified.slice(-300));
  return due.length;
};
