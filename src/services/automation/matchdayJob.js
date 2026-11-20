/**
 * Resumen de inicio de jornada: 1 h antes del primer partido envía a Telegram
 * (y como notificación de Windows) las expectativas de la alineación guardada.
 *
 * Se lanza de dos formas:
 *   - con la app abierta, el vigilante (DailyAutomation) lo ejecuta cuando toca;
 *   - con la app cerrada, una tarea de Windows de un solo uso (que programa el
 *     informe diario) abre la app con `--daily-run --matchday`.
 */
import { loadLeagueData } from './dataLoader';
import { buildReportModel } from './report';
import { loadSettings, loadState, saveState } from './localStore';
import { buildMatchdaySummary, renderMatchdayTelegram } from './matchdaySummary';
import { MATCHDAY_SUMMARY_LEAD_MS } from '../analytics/matchday';
import { N, dt } from './reportFormat';

/** ¿Toca enviar el resumen? (función pura) */
export const isMatchdaySummaryDue = (state, settings, now = new Date()) => {
  if (settings?.matchdaySummaryEnabled === false) return false;
  const ko = state?.nextKickoff ? new Date(state.nextKickoff).getTime() : NaN;
  if (!Number.isFinite(ko)) return false;
  const t = now.getTime();
  return t >= ko - MATCHDAY_SUMMARY_LEAD_MS && t < ko && state.lastMatchdaySummaryFor !== state.nextKickoff;
};

/** Hora a la que programar la tarea de un solo uso (ISO) o null. */
export const matchdaySummaryTime = (kickoff, now = new Date()) => {
  const ko = kickoff ? new Date(kickoff).getTime() : NaN;
  if (!Number.isFinite(ko)) return null;
  const at = ko - MATCHDAY_SUMMARY_LEAD_MS;
  return at > now.getTime() ? new Date(at).toISOString() : null;
};

let running = null;

export const runMatchdayJob = async ({ leagueId, user, leagueName }) => {
  if (running) return running;
  running = (async () => {
    const settings = await loadSettings();
    const ea = window.electronAPI?.automation;
    const tg = settings.telegramEnabled ? window.electronAPI?.telegram : null;
    try {
      const data = await loadLeagueData({ leagueId, user });
      const model = buildReportModel(data, { settings, leagueName });
      const summary = buildMatchdaySummary(model, { ...data.savedLineup, ids: data.currentLineupIds });
      if (tg) {
        const r = await tg.sendMessage(renderMatchdayTelegram(summary));
        if (!r?.success) throw new Error(`Telegram falló: ${r?.error}`);
      }
      if (ea) {
        const warn = summary.problems.length || summary.missing ? ' · ⚠️ revisa la alineación' : '';
        await ea.notify(`⚽ Jornada ${summary.week ?? ''}: empieza ${dt(summary.kickoff)}`,
          `Tu alineación: ${N(summary.total)} pts previstos (recomendada ${N(summary.recommended.total)})${warn}`);
      }
      const state = await loadState();
      await saveState({
        ...state,
        nextKickoff: data.matchday?.kickoff || state.nextKickoff,
        lastMatchdaySummaryFor: data.matchday?.kickoff || state.nextKickoff,
        lastMatchdaySummaryAt: new Date().toISOString(),
      });
      return { success: true, summary };
    } catch (error) {
      if (ea) await ea.notify('Resumen de jornada: error', error.message);
      return { success: false, error: error.message };
    }
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
};
