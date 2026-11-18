/**
 * Trabajo diario (tras el reseteo del mercado de las 19:00):
 *   1. descarga datos frescos de la liga
 *   2. guarda una captura local del día
 *   3. auto-mercado (si está activado)
 *   4. genera informe-fantasy.md + plantilla.json en la carpeta de exportación
 *      (sobrescribe el anterior → en Drive solo queda el último)
 *   5. notificación de Windows
 */
import { loadLeagueData } from './dataLoader';
import { runAutoMarket } from './autoMarket';
import { buildDailyReport, buildSnapshot } from './report';
import { loadSettings, loadState, saveState, writeJson, snapshotFile } from './localStore';
import { fantasyAPI } from '../api';
import { extractArray } from '../../utils/helpers';

export const REPORT_FILE = 'informe-fantasy.md';
export const DATA_FILE = 'plantilla.json';

/** Último instante programado (hh:mm) que ya ha pasado respecto a `now`. */
export const lastScheduledSlot = (now, hour, minute) => {
  const slot = new Date(now);
  slot.setHours(hour, minute, 0, 0);
  if (slot > now) slot.setDate(slot.getDate() - 1);
  return slot;
};

/** ¿Toca ejecutar? Sí si no se ha ejecutado desde el último horario. */
export const isRunDue = (state, settings, now = new Date()) => {
  if (!settings.dailyReportEnabled) return false;
  const slot = lastScheduledSlot(now, settings.runHour, settings.runMinute);
  const last = state?.lastSuccessAt ? new Date(state.lastSuccessAt) : null;
  return !last || last < slot;
};

const localDate = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

let running = null;

export const runDailyJob = async ({ leagueId, user, leagueName, source = 'manual' }) => {
  if (running) return running; // nunca dos ejecuciones a la vez
  running = (async () => {
    const startedAt = new Date().toISOString();
    const settings = await loadSettings();
    const state = await loadState();
    const ea = window.electronAPI?.automation;
    try {
      const data = await loadLeagueData({ leagueId, user });

      await writeJson(snapshotFile(localDate()), buildSnapshot(data));

      let autoMarketLog = [];
      if (settings.autoMarketEnabled) {
        autoMarketLog = await runAutoMarket({
          leagueId,
          myTeam: data.myTeam,
          excluded: settings.autoMarketExcluded,
          dryRun: settings.autoMarketDryRun,
        });
      }

      // Nombres para el historial de ventas (jugadores que ya no están en plantillas)
      let playerNames = new Map();
      try {
        extractArray(await fantasyAPI.getAllPlayers()).forEach((p) => playerNames.set(String(p.id), p.nickname || p.name));
      } catch { /* opcional */ }

      const report = buildDailyReport(data, { settings, autoMarketLog, playerNames, leagueName });

      let exportResult = { success: false, error: 'Solo disponible en la app de escritorio' };
      if (ea) {
        exportResult = await ea.writeExport([
          { name: REPORT_FILE, content: report.markdown },
          { name: DATA_FILE, content: JSON.stringify(report.json, null, 2) },
        ]);
      }
      if (!exportResult.success) throw new Error(`No se pudo escribir el informe: ${exportResult.error}`);

      const listed = autoMarketLog.filter((l) => l.status === 'listed').length;
      const newState = {
        ...state,
        lastRunAt: startedAt,
        lastSuccessAt: new Date().toISOString(),
        lastSource: source,
        lastError: null,
        lastExportDir: exportResult.dir,
        lastAutoMarket: autoMarketLog,
        lastCounts: report.counts,
      };
      await saveState(newState);

      if (ea) {
        const parts = [`${report.counts.econ} oportunidades de mercado`, `${report.counts.clauseSoon} cláusulas en 48 h`];
        if (report.counts.alerts) parts.push(`${report.counts.alerts} aviso(s)`);
        if (settings.autoMarketEnabled) parts.push(settings.autoMarketDryRun ? `${autoMarketLog.length} al mercado (simulado)` : `${listed} puestos en venta`);
        await ea.notify('Informe Fantasy listo', parts.join(' · '));
      }
      return { success: true, state: newState, report };
    } catch (error) {
      const newState = { ...state, lastRunAt: startedAt, lastError: error.message, lastSource: source };
      await saveState(newState);
      if (ea) await ea.notify('Informe Fantasy: error', error.message);
      return { success: false, error: error.message, state: newState };
    }
  })();
  try {
    return await running;
  } finally {
    running = null;
  }
};
