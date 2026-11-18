/**
 * Almacenamiento local de la automatización (estado, ajustes, capturas
 * diarias). En Electron va a la carpeta de datos de la app (userData), que
 * es la misma en desarrollo y en el ejecutable; en navegador, a localStorage.
 * Nunca se guarda nada de autenticación aquí.
 */
const PREFIX = 'fantasy-data/';
const hasElectron = () => typeof window !== 'undefined' && !!window.electronAPI?.savePersistentFile;

// El canal de Electron exige rutas absolutas dentro de userData.
let basePathPromise = null;
const electronPath = async (name) => {
  if (!basePathPromise) basePathPromise = window.electronAPI.getAppDataPath();
  const base = await basePathPromise;
  if (!base) throw new Error('Sin carpeta de datos de la app');
  const sep = base.includes('\\') ? '\\' : '/';
  return [base, ...`${PREFIX}${name}`.split('/')].join(sep);
};

export const readJson = async (name, fallback = null) => {
  try {
    const raw = hasElectron()
      ? await window.electronAPI.loadPersistentFile(await electronPath(name))
      : localStorage.getItem(PREFIX + name);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

export const writeJson = async (name, value) => {
  const raw = JSON.stringify(value);
  if (hasElectron()) {
    try {
      return await window.electronAPI.savePersistentFile(await electronPath(name), raw);
    } catch {
      return false;
    }
  }
  try {
    localStorage.setItem(PREFIX + name, raw);
    return true;
  } catch {
    return false;
  }
};

export const SETTINGS_FILE = 'settings.json';
export const STATE_FILE = 'state.json';
export const snapshotFile = (date) => `snapshots/${date}.json`;

export const DEFAULT_SETTINGS = {
  dailyReportEnabled: true,
  runHour: 19,
  runMinute: 5,
  autoMarketEnabled: false,   // desactivado hasta que el usuario lo active
  autoMarketDryRun: true,     // simulación: registra lo que haría sin hacerlo
  autoMarketExcluded: [],     // playerMaster ids que nunca se ponen a la venta
  initialMoney: 100_000_000,
  projectionDays: 5,
};

export const loadSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await readJson(SETTINGS_FILE, {})) });
export const saveSettings = (s) => writeJson(SETTINGS_FILE, s);
export const loadState = () => readJson(STATE_FILE, {});
export const saveState = (s) => writeJson(STATE_FILE, s);
