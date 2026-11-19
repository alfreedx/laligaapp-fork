import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FolderOpen, Play, Bot, FileText, AlertTriangle, CheckCircle2, Bell } from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import useTeamService from '../../hooks/useTeamService';
import { fantasyAPI } from '../../services/api';
import { extractTeamPlayers } from '../../utils/fetchAllTeamsData';
import { runDailyJob } from '../../services/automation/dailyJob';
import { loadSettings, saveSettings, loadState } from '../../services/automation/localStore';
import { planAutoMarket } from '../../services/automation/autoMarket';
import { EDITIONS, editionForTime, parseTime, scheduleTimes } from '../../services/automation/schedule';
import TelegramSettings from './TelegramSettings';

const fmtDate = (v) => (v ? new Date(v).toLocaleString('es-ES') : '—');
const fmtM = (v) => (typeof v === 'number' ? `${(v / 1e6).toFixed(2).replace('.', ',')} M` : '—');
const POS = { 1: 'POR', 2: 'DEF', 3: 'MED', 4: 'DEL', 5: 'ENT' };

const Toggle = ({ checked, onChange, label, hint }) => (
  <label className="flex items-start gap-3 cursor-pointer">
    <input type="checkbox" className="mt-1 w-4 h-4" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
    <span>
      <span className="font-medium">{label}</span>
      {hint && <span className="block text-xs text-gray-500">{hint}</span>}
    </span>
  </label>
);

const AutomationSettings = () => {
  const leagueId = useAuthStore((s) => s.leagueId);
  const leagueName = useAuthStore((s) => s.leagueName);
  const user = useAuthStore((s) => s.user);
  const ea = window.electronAPI?.automation;

  const [settings, setSettings] = useState(null);
  const [state, setState] = useState({});
  const [config, setConfig] = useState({});
  const [running, setRunning] = useState(false);

  const { data: teamInit } = useTeamService(leagueId, user);
  const myTeamId = teamInit?.teamId;
  const { data: myTeamRes } = useQuery({
    queryKey: ['teamData', leagueId, myTeamId],
    queryFn: () => fantasyAPI.getTeamData(leagueId, myTeamId),
    enabled: !!leagueId && !!myTeamId,
    staleTime: 60 * 1000,
  });
  const myPlayers = extractTeamPlayers(myTeamRes);

  useEffect(() => {
    (async () => {
      setSettings(await loadSettings());
      setState(await loadState());
      if (ea) setConfig(await ea.getConfig());
    })();
  }, [ea]);

  const update = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
  };

  const runNow = async () => {
    setRunning(true);
    const res = await runDailyJob({ leagueId, user, leagueName, source: 'manual' });
    setRunning(false);
    setState(res.state || (await loadState()));
    if (res.success) toast.success('Informe generado');
    else toast.error(res.error || 'Error generando el informe');
  };

  if (!settings) return null;
  const times = scheduleTimes(settings);

  const excluded = new Set(settings.autoMarketExcluded.map(String));
  const toggleExcluded = (id) => {
    const next = new Set(excluded);
    if (next.has(id)) next.delete(id); else next.add(id);
    update({ autoMarketExcluded: [...next] });
  };
  const plan = planAutoMarket({ players: myPlayers }, { excluded: settings.autoMarketExcluded });

  return (
    <div className="space-y-6">
      {/* Informe diario */}
      <div className="card p-6 space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2"><FileText className="w-5 h-5 text-primary-500" /> Informe diario</h2>
        <Toggle
          checked={settings.dailyReportEnabled}
          onChange={(v) => update({ dailyReportEnabled: v })}
          label="Generar el informe automáticamente cada día"
          hint="En cada hora programada. Si a esa hora la app no estaba abierta, se genera en cuanto la abras."
        />
        <div className="space-y-2 text-sm">
          {times.map((t, i) => {
            const ed = EDITIONS[editionForTime(parseTime(t))];
            return (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  type="time"
                  className="input-field !py-1 w-28"
                  value={t}
                  onChange={(e) => {
                    if (!parseTime(e.target.value)) return;
                    const next = [...times];
                    next[i] = e.target.value;
                    update({ runTimes: next });
                  }}
                />
                <span>{ed.icon} <b>{ed.label}</b></span>
                <span className="text-gray-500 text-xs">
                  {editionForTime(parseTime(t)) === 'cierre'
                    ? 'para actuar sobre el mercado del día (ofertas y pujas se resuelven a las 19:00)'
                    : 'mercado nuevo; aquí se ejecuta el auto-mercado'}
                </span>
                {times.length > 1 && (
                  <button className="text-xs text-red-600 hover:underline" onClick={() => update({ runTimes: times.filter((_, j) => j !== i) })}>quitar</button>
                )}
              </div>
            );
          })}
          {times.length < 4 && (
            <button className="text-xs text-primary-600 hover:underline" onClick={() => update({ runTimes: [...times, '21:00'] })}>+ añadir hora</button>
          )}
          <p className="text-xs text-gray-500">
            El mercado se resetea a las 19:00. Si cambias las horas, vuelve a registrar la tarea programada para que el PC despierte a esas horas:
            <code className="ml-1">scripts/register-task.ps1 -At {times.join(',')}</code>
          </p>
        </div>

        <div className="text-sm space-y-1">
          <div>Carpeta del informe:</div>
          <div className="font-mono text-xs bg-gray-100 dark:bg-gray-800 rounded p-2 break-all">{config.exportDir || 'Solo disponible en la app de escritorio'}</div>
          <div className="text-xs text-gray-500">
            Elige una carpeta de tu <b>Google Drive</b> (p. ej. <code>G:\Mi unidad\Fantasy</code>) para que el informe se suba solo. Se guardan <code>informe-fantasy.pdf</code> (para leerlo en el móvil o el PC), <code>informe-fantasy.md</code> y <code>plantilla.json</code> (para Claude), sobrescribiendo los del día anterior.
          </div>
          {ea && (
            <div className="flex flex-wrap gap-2 pt-1">
              <button className="btn-secondary !py-1.5 text-sm flex items-center gap-1" onClick={async () => { const r = await ea.chooseExportDir(); setConfig((c) => ({ ...c, exportDir: r.exportDir })); }}>
                <FolderOpen className="w-4 h-4" /> Cambiar carpeta
              </button>
              <button className="btn-secondary !py-1.5 text-sm" onClick={() => ea.openExportDir()}>Abrir carpeta</button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary flex items-center gap-1" onClick={runNow} disabled={running || !leagueId}>
            <Play className="w-4 h-4" /> {running ? 'Generando… (1-2 min)' : 'Generar informe ahora'}
          </button>
          <div className="text-sm">
            {state.lastError
              ? <span className="text-red-600 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> Último intento {fmtDate(state.lastRunAt)}: {state.lastError}</span>
              : <span className="text-green-700 dark:text-green-400 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Último informe: {fmtDate(state.lastSuccessAt)} {state.lastEdition ? `· ${EDITIONS[state.lastEdition]?.label}` : ''} {state.lastSource ? `(${state.lastSource})` : ''}</span>}
          </div>
        </div>
      </div>

      <TelegramSettings settings={settings} update={update} />

      {/* Avisos de cláusulas */}
      <div className="card p-6 space-y-3">
        <h2 className="text-xl font-bold flex items-center gap-2"><Bell className="w-5 h-5 text-primary-500" /> Avisos de cláusulas</h2>
        <Toggle
          checked={settings.clauseAlertsEnabled}
          onChange={(v) => update({ clauseAlertsEnabled: v })}
          label="Avisarme 2 minutos antes de que se abra la cláusula de un jugador rival"
          hint="Notificación de Windows (y Telegram si está activado) 2 min antes de la apertura, con precio y puntos esperados. Usa la lista del último informe (próximas 48 h). Solo funciona con la app abierta (puede estar minimizada)."
        />
        {state.clauseWatch?.length > 0 && (
          <div className="text-xs text-gray-600 dark:text-gray-300">
            Próximas aperturas vigiladas:
            <ul className="list-disc ml-5">
              {state.clauseWatch.map((w) => (
                <li key={`${w.id}-${w.openAt}`}>{fmtDate(w.openAt)} — {w.name} ({w.owner}), {fmtM(w.clause)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Auto-mercado */}
      <div className="card p-6 space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2"><Bot className="w-5 h-5 text-primary-500" /> Auto-mercado</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          En cada ejecución diaria, pone a la venta <b>a su valor de mercado</b> a tus jugadores que no estén ya en el mercado,
          para recibir la oferta diaria de LaLiga (±10 %). <b>Nunca acepta ofertas</b>, ni puja, ni retira jugadores: eso lo decides tú siempre.
        </p>
        <div className="text-xs text-amber-700 dark:text-amber-400 flex gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          La API de LaLiga Fantasy no es pública: automatizar acciones podría ir contra sus condiciones. Se hace a ritmo humano (1,5 s entre jugadores) una vez al día.
        </div>
        <Toggle checked={settings.autoMarketEnabled} onChange={(v) => update({ autoMarketEnabled: v })} label="Activar auto-mercado" />
        <Toggle
          checked={settings.autoMarketDryRun}
          onChange={(v) => update({ autoMarketDryRun: v })}
          label="Modo simulación"
          hint="Solo registra en el informe lo que haría, sin tocar tu cuenta. Desactívalo cuando hayas comprobado que es lo que quieres."
        />

        <div>
          <div className="text-sm font-medium mb-2">Jugadores (desmarca los que NUNCA quieres poner en venta):</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
            {[...myPlayers].sort((a, b) => (a.playerMaster?.positionId - b.playerMaster?.positionId)).map((pt) => {
              const id = String(pt.playerMaster?.id);
              return (
                <label key={id} className="flex items-center gap-2 text-sm py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800">
                  <input type="checkbox" checked={!excluded.has(id)} onChange={() => toggleExcluded(id)} />
                  <span className="w-8 text-xs text-gray-500">{POS[pt.playerMaster?.positionId]}</span>
                  <span className="flex-1">{pt.playerMaster?.nickname || pt.playerMaster?.name}</span>
                  <span className="text-xs text-gray-500">{pt.playerMarket ? '🏷️ en mercado' : fmtM(pt.playerMaster?.marketValue)}</span>
                </label>
              );
            })}
          </div>
          <div className="text-xs text-gray-500 mt-2">
            Ahora mismo pondría a la venta: {plan.length ? plan.map((p) => p.name).join(', ') : 'nadie (ya están todos en el mercado o excluidos)'}.
          </div>
        </div>

        {state.lastAutoMarket?.length > 0 && (
          <div className="text-sm">
            <div className="font-medium">Última ejecución:</div>
            <ul className="text-xs list-disc ml-5">
              {state.lastAutoMarket.map((l) => (
                <li key={l.playerId}>{l.name} a {fmtM(l.price)} — {l.status === 'listed' ? '✅ en venta' : l.status === 'simulated' ? '🧪 simulado' : `❌ ${l.error}`}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default AutomationSettings;
