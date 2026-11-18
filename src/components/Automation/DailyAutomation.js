import { useEffect, useRef } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { runDailyJob, isRunDue } from '../../services/automation/dailyJob';
import { loadSettings, loadState } from '../../services/automation/localStore';
import { checkClauseAlerts } from '../../services/automation/clauseAlerts';

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

    (async () => {
      const cfg = ea ? await ea.getConfig() : {};
      // Lanzada por la tarea programada: ejecutar siempre y cerrar al terminar.
      const result = await run(cfg.isDailyRun ? 'scheduler' : 'startup', !!cfg.isDailyRun);
      if (cfg.isDailyRun && !cancelled) await ea.dailyRunFinished(result?.success ? 'ok' : 'error');
    })();

    const timer = setInterval(() => {
      run('timer');
      checkClauseAlerts().catch(() => {});
    }, CHECK_EVERY_MS);
    const unsub = ea?.onRunNow?.(() => { run('scheduler', true); });

    return () => {
      cancelled = true;
      clearInterval(timer);
      unsub?.();
    };
  }, [ready]);

  return null;
};

export default DailyAutomation;
