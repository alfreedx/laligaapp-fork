import { useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { runDailyJob, isRunDue } from '../../services/automation/dailyJob';
import { loadSettings, loadState } from '../../services/automation/localStore';
import { checkClauseAlerts } from '../../services/automation/clauseAlerts';
import { runMatchdayJob, isMatchdaySummaryDue } from '../../services/automation/matchdayJob';
import { handleBotMessage } from '../../services/automation/botHandler';
import { runXpBacktest } from '../../services/automation/xpBacktestJob';
import { logEvent, logError } from '../../services/automation/log';

const CHECK_EVERY_MS = 60 * 1000;

/**
 * Vigilante invisible: mientras la app está abierta y con sesión, ejecuta el
 * trabajo diario cuando toca (19:05 o en cuanto se pueda si se perdió) y
 * atiende las peticiones del Programador de tareas (--daily-run).
 */
const DailyAutomation = () => {
  const leagueId = useAuthStore((s) => s.leagueId);
  const leagueName = useAuthStore((s) => s.leagueName);
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const ctx = useRef({});
  ctx.current = { leagueId, leagueName, user };

  const ready = isAuthenticated && !!leagueId && !!(user?.userId || user?.id);

  useEffect(() => {
    if (!ready) return undefined;
    const ea = window.electronAPI?.automation;
    let cancelled = false;

    const run = async (source, force = false) => {
      const settings = await loadSettings();
      const state = await loadState();
      if (!force && !isRunDue(state, settings)) return null;
      const { leagueId: lid, leagueName: lname, user: u } = ctx.current;
      return runDailyJob({ leagueId: lid, user: u, leagueName: lname, source });
    };

    // Resumen de inicio de jornada (1 h antes del primer partido)
    const runMatchday = async (force = false) => {
      const [settings, state] = await Promise.all([loadSettings(), loadState()]);
      // La tarea programada fuerza la hora, pero nunca se envía dos veces para el mismo partido
      const alreadySent = !!state.lastMatchdaySummaryFor && state.lastMatchdaySummaryFor === state.nextKickoff;
      if (force ? alreadySent : !isMatchdaySummaryDue(state, settings)) return { success: true, skipped: true };
      const { leagueId: lid, leagueName: lname, user: u } = ctx.current;
      return runMatchdayJob({ leagueId: lid, user: u, leagueName: lname });
    };

    (async () => {
      const cfg = ea ? await ea.getConfig() : {};
      // Backtest del xP (solo lectura): calcula, guarda xp-backtest.json y cierra
      if (cfg.isDailyRun && cfg.dailyRunMode === 'backtest') {
        const { leagueId: lid, user: u } = ctx.current;
        let ok = false;
        try {
          const r = await runXpBacktest({ leagueId: lid, user: u });
          ok = true;
          await ea.notify('Backtest del xP terminado', `${r.weeks.length} jornadas evaluadas`);
        } catch (e) {
          await ea.notify('Backtest del xP: error', e.message);
        }
        if (!cancelled) await ea.dailyRunFinished(ok ? 'ok' : 'error');
        return;
      }
      // Abierta por un aviso de /clausula: esperar a que toque (≤ 5 min), avisar y cerrar
      if (cfg.isDailyRun && cfg.dailyRunMode === 'alerts') {
        let sent = 0;
        for (let i = 0; i < 25 && !sent && !cancelled; i++) {
          sent = await checkClauseAlerts().catch((e) => { logEvent('error', 'avisos', e); return 0; });
          if (!sent) await new Promise((r) => setTimeout(r, 15000));
        }
        if (!cancelled) await ea.dailyRunFinished('ok');
        return;
      }
      if (cfg.isDailyRun && cfg.dailyRunMode === 'matchday') {
        const r = await runMatchday(true);
        if (!cancelled) await ea.dailyRunFinished(r?.success ? 'ok' : 'error');
        return;
      }
      // Lanzada por la tarea programada: ejecutar siempre y cerrar al terminar.
      const result = await run(cfg.isDailyRun ? 'scheduler' : 'startup', !!cfg.isDailyRun);
      if (cfg.isDailyRun && !cancelled) await ea.dailyRunFinished(result?.success ? 'ok' : 'error');
    })();

    const timer = setInterval(() => {
      run('timer');
      checkClauseAlerts().catch(logError('avisos'));
      runMatchday().catch(logError('resumen-jornada'));
    }, CHECK_EVERY_MS);
    const unsub = ea?.onRunNow?.((d) => {
      // Cada modo explícito: un modo desconocido nunca lanza el informe (ni el auto-mercado)
      if (d?.mode === 'matchday') runMatchday(true);
      else if (d?.mode === 'alerts') checkClauseAlerts().catch(logError('avisos'));
      else if (d?.mode === 'backtest') {
        const { leagueId: lid, user: u } = ctx.current;
        runXpBacktest({ leagueId: lid, user: u })
          .then((r) => ea.notify('Backtest del xP terminado', `${r.weeks.length} jornadas evaluadas`))
          .catch((e) => ea.notify('Backtest del xP: error', e.message));
      } else if (!d?.mode || d.mode === 'report') run('scheduler', true);
    });

    // Bot de Telegram: comandos como /clausula (solo del chat configurado)
    const tg = window.electronAPI?.telegram;
    const unsubBot = tg?.onCommand?.((msg) => {
      const { leagueId: lid, user: u } = ctx.current;
      handleBotMessage(msg, { leagueId: lid, user: u }).catch(logError('bot'));
    });
    tg?.startBot?.().then((r) => { if (r && !r.success) logEvent('info', 'bot', r.error); }).catch(logError('bot'));

    return () => {
      cancelled = true;
      clearInterval(timer);
      unsub?.();
      unsubBot?.();
    };
  }, [ready]);

  return null;
};

export default DailyAutomation;
