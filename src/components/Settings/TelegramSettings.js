import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Send, KeyRound, Search, CheckCircle2 } from 'lucide-react';
import { PDF_FILE } from '../../services/automation/dailyJob';

const Toggle = ({ checked, onChange, label, hint, disabled }) => (
  <label className={`flex items-start gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
    <input type="checkbox" className="mt-1 w-4 h-4" checked={!!checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span>
      <span className="font-medium">{label}</span>
      {hint && <span className="block text-xs text-gray-500">{hint}</span>}
    </span>
  </label>
);

/**
 * Configuración del bot de Telegram. La clave se envía una sola vez al
 * proceso principal, que la cifra; la interfaz nunca la vuelve a leer.
 */
const TelegramSettings = ({ settings, update }) => {
  const tg = window.electronAPI?.telegram;
  const [cfg, setCfg] = useState(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async () => { if (tg) setCfg(await tg.getConfig()); };
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tg) {
    return (
      <div className="card p-6"><h2 className="text-xl font-bold">📱 Notificaciones al móvil (Telegram)</h2>
        <p className="text-sm text-gray-500 mt-2">Solo disponible en la app de escritorio.</p></div>
    );
  }

  const saveToken = async () => {
    setBusy(true);
    const r = await tg.setToken(token);
    setBusy(false);
    if (r.success) { setToken(''); toast.success('Clave guardada (cifrada)'); refresh(); } else toast.error(r.error);
  };
  const detect = async () => {
    setBusy(true);
    const r = await tg.detectChat();
    setBusy(false);
    if (r.success) { toast.success(`Chat detectado: ${r.chatName}`); update({ telegramEnabled: true }); refresh(); tg.startBot?.(); } else toast.error(r.error, { duration: 8000 });
  };
  const test = async (withPdf) => {
    setBusy(true);
    let r = await tg.sendMessage('✅ <b>LaLiga Fantasy</b>\nLas notificaciones al móvil funcionan.');
    if (r.success && withPdf) r = await tg.sendDocument(PDF_FILE, '📄 Último informe generado');
    setBusy(false);
    if (r.success) toast.success('Enviado: revisa Telegram'); else toast.error(r.error, { duration: 8000 });
  };
  const forget = async () => {
    await tg.setToken('');
    update({ telegramEnabled: false });
    refresh();
    toast.success('Configuración de Telegram borrada');
  };

  const ready = cfg?.hasToken && cfg?.chatId;

  return (
    <div className="card p-6 space-y-4">
      <h2 className="text-xl font-bold flex items-center gap-2"><Send className="w-5 h-5 text-sky-500" /> Notificaciones al móvil (Telegram)</h2>

      {!ready && (
        <ol className="text-sm list-decimal ml-5 space-y-1 text-gray-700 dark:text-gray-200">
          <li>En Telegram, abre <b>@BotFather</b>, escribe <code>/newbot</code>, elige un nombre y un usuario acabado en <code>bot</code>.</li>
          <li>Copia la <b>clave</b> que te da (parecida a <code>123456789:AA…</code>) y pégala aquí abajo.</li>
          <li>Abre tu nuevo bot en Telegram y pulsa <b>Iniciar</b>.</li>
          <li>Pulsa <b>Detectar mi chat</b> y después <b>Enviar prueba</b>.</li>
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <KeyRound className="w-4 h-4 text-gray-500" />
        {cfg?.hasToken
          ? <span className="text-green-700 dark:text-green-400 flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Clave guardada (cifrada)</span>
          : <span className="text-gray-500">Sin clave</span>}
        <input
          type="password"
          autoComplete="off"
          className="input-field !py-1.5 flex-1 min-w-[220px]"
          placeholder={cfg?.hasToken ? 'Pegar otra clave para cambiarla' : 'Clave del bot (de @BotFather)'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button className="btn-secondary !py-1.5 text-sm" disabled={busy || !token.trim()} onClick={saveToken}>Guardar clave</button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button className="btn-secondary !py-1.5 text-sm flex items-center gap-1" disabled={busy || !cfg?.hasToken} onClick={detect}>
          <Search className="w-4 h-4" /> Detectar mi chat
        </button>
        {cfg?.chatId && <span className="text-green-700 dark:text-green-400">Chat: {cfg.chatName}</span>}
        <button className="btn-primary !py-1.5 text-sm" disabled={busy || !ready} onClick={() => test(false)}>Enviar prueba</button>
        <button className="btn-secondary !py-1.5 text-sm" disabled={busy || !ready} onClick={() => test(true)}>Prueba + último PDF</button>
        {cfg?.hasToken && <button className="text-xs text-red-600 hover:underline ml-auto" onClick={forget}>Borrar configuración</button>}
      </div>

      <div className="space-y-2">
        <Toggle disabled={!ready} checked={settings.telegramEnabled} onChange={(v) => update({ telegramEnabled: v })}
          label="Enviar cada informe a Telegram" hint="Mensaje con las cifras clave y «Qué hacer», en cada hora programada." />
        <Toggle disabled={!ready || !settings.telegramEnabled} checked={settings.telegramSendPdf} onChange={(v) => update({ telegramSendPdf: v })}
          label="Adjuntar el PDF del informe" />
        <Toggle disabled={!ready || !settings.telegramEnabled} checked={settings.telegramClauseAlerts} onChange={(v) => update({ telegramClauseAlerts: v })}
          label="Avisos de apertura de cláusulas" hint="2 min antes de que se abran. Solo mientras la app esté abierta en el PC." />
        <Toggle disabled={!ready || !settings.telegramEnabled} checked={settings.matchdaySummaryEnabled !== false} onChange={(v) => update({ matchdaySummaryEnabled: v })}
          label="Resumen al empezar la jornada" hint="1 h antes del primer partido: puntos previstos de tu alineación guardada, dudas y cambios sugeridos. La app lo programa sola (despierta el portátil)." />
      </div>
      {ready && (
        <div className="text-sm rounded-lg bg-sky-50 dark:bg-sky-900/20 p-3 space-y-1">
          <div className="font-medium">🤖 Comandos del bot</div>
          <div><code>/clausula nombre</code>: cuándo se abre la cláusula de cualquier jugador de la liga, precio y si te llega. Te avisa 2 min antes y te manda un evento con alarma para el calendario del móvil.</div>
          <div><code>/avisos</code>: avisos pendientes · <code>/ayuda</code></div>
          <div className="text-xs text-gray-500">Solo responde a tu chat y mientras la app esté abierta en el PC (si estaba dormido, al despertarse).</div>
        </div>
      )}
      <p className="text-xs text-gray-500">
        Los mensajes los envía tu PC: llegan si a esa hora está encendido o en suspensión (la tarea programada lo despierta). La clave del bot se guarda cifrada con tu usuario de Windows y no sale de este equipo salvo hacia api.telegram.org.
      </p>
    </div>
  );
};

export default TelegramSettings;
