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
import { loadSettings, loadState, saveState, writeJson, readJson, snapshotFile } from './localStore';
import { clauseRaisesBetween } from '../analytics/rivalIntel';
import { reportHtmlDocument } from './mdToHtml';
import { buildPredictionRecord, actualPointsForWeek, evaluateWeek } from '../analytics/backtest';

export const REPORT_FILE = 'informe-fantasy.md';
export const DATA_FILE = 'plantilla.json';
export const PDF_FILE = 'informe-fantasy.pdf';

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

      // Captura de hoy + subidas de cláusula respecto a la captura anterior más reciente (≤ 7 días)
      const today = localDate();
      const snapshot = buildSnapshot(data);
      let prevSnap = null;
      for (let back = 1; back <= 7 && !prevSnap; back++) {
        const d = new Date();
        d.setDate(d.getDate() - back);
        prevSnap = await readJson(snapshotFile(localDate(d)), null);
      }
      await writeJson(snapshotFile(today), snapshot);
      const clauseRaises = { ...(state.clauseRaises || {}) };
      if (prevSnap) {
        const raises = clauseRaisesBetween(prevSnap, snapshot, { costFactor: settings.clauseRaiseCostFactor });
        clauseRaises[today] = Object.fromEntries(raises); // re-ejecutar el mismo día sobrescribe, no duplica
      }
      const clauseSpend = new Map();
      Object.values(clauseRaises).forEach((day) => Object.entries(day).forEach(([mid, r]) => {
        clauseSpend.set(mid, (clauseSpend.get(mid) || 0) + (r.estimatedCost || 0));
      }));

      let autoMarketLog = [];
      if (settings.autoMarketEnabled) {
        autoMarketLog = await runAutoMarket({
          leagueId,
          myTeam: data.myTeam,
          excluded: settings.autoMarketExcluded,
          dryRun: settings.autoMarketDryRun,
        });
      }

      // Evaluar previsiones de jornadas ya terminadas con los puntos reales
      const predictions = { ...(state.predictions || {}) };
      const backtests = { ...(state.backtests || {}) };
      const now = new Date();
      const closed = (w) => w < data.week || (w === data.week && data.weekInfo?.closingWeekDate && now > new Date(data.weekInfo.closingWeekDate));
      Object.keys(predictions).map(Number).filter((w) => data.week && closed(w)).forEach((w) => {
        const actual = actualPointsForWeek(data.teams, w);
        if (actual.size) backtests[w] = evaluateWeek(predictions[w], actual);
      });

      const report = buildDailyReport(data, { settings, autoMarketLog, playerNames: data.playerNames, leagueName, clauseSpend, backtests });

      // Guardar la previsión de la jornada mientras no haya empezado (la última antes del inicio cuenta)
      if (data.week && data.weekInfo?.openingWeekDate && now < new Date(data.weekInfo.openingWeekDate)) {
        predictions[data.week] = buildPredictionRecord(report.predictionRows, { lineupIds: report.lineupIds, captainId: report.captainId });
      }
      const keepLast = (obj, n) => Object.fromEntries(Object.entries(obj).sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, n));

      let exportResult = { success: false, error: 'Solo disponible en la app de escritorio' };
      if (ea) {
        exportResult = await ea.writeExport([
          { name: REPORT_FILE, content: report.markdown },
          { name: DATA_FILE, content: JSON.stringify(report.json, null, 2) },
        ]);
      }
      if (!exportResult.success) throw new Error(`No se pudo escribir el informe: ${exportResult.error}`);

      // PDF legible en móvil y PC (Google Drive lo previsualiza sin apps extra)
      let pdfError = null;
      if (ea?.writePdf) {
        const pdf = await ea.writePdf(PDF_FILE, reportHtmlDocument(report.markdown, `Informe Fantasy ${localDate()}`));
        if (!pdf?.success) pdfError = pdf?.error || 'error desconocido';
      }

      const listed = autoMarketLog.filter((l) => l.status === 'listed').length;
      const newState = {
        ...state,
        lastRunAt: startedAt,
        lastSuccessAt: new Date().toISOString(),
        lastSource: source,
        lastError: pdfError ? `Informe generado, pero el PDF falló: ${pdfError}` : null,
        lastExportDir: exportResult.dir,
        lastAutoMarket: autoMarketLog,
        lastCounts: report.counts,
        clauseRaises: keepLast(clauseRaises, 60),
        predictions: keepLast(predictions, 8),
        backtests: keepLast(backtests, 20),
        clauseWatch: report.clauseWatch,
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
