/**
 * Registro de la automatización desde el renderer (→ automation.log en el proceso
 * principal). Nunca lanza: si no hay Electron o falla, solo queda en la consola.
 */
export const logEvent = (level, source, message) => {
  const text = message instanceof Error ? message.message : String(message ?? '');
  try {
    // eslint-disable-next-line no-console
    if (level !== 'info') console.warn(`[${source}] ${text}`);
    window.electronAPI?.automation?.log?.(level, source, text)?.catch?.(() => {});
  } catch { /* nunca rompe */ }
};

export const logError = (source) => (error) => logEvent('error', source, error);
