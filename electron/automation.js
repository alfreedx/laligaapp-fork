/**
 * Automatización diaria (fork): carpeta de exportación del informe,
 * escritura de archivos, notificaciones y modo `--daily-run` (lanzado por
 * el Programador de tareas de Windows a las 19:05).
 */
const { app, ipcMain, dialog, shell, Notification, powerSaveBlocker } = require('electron');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'fantasy-automation.json');
const SAFE_NAME = /^[A-Za-z0-9._-]{1,80}$/;
const DAILY_RUN_FLAG = '--daily-run';
const DAILY_RUN_TIMEOUT_MS = 10 * 60 * 1000;

const isDailyRun = (argv = process.argv) => argv.includes(DAILY_RUN_FLAG);

const readConfig = () => {
    try {
        return JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
    } catch {
        return {};
    }
};

const writeConfig = (cfg) => {
    fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
    fs.writeFileSync(CONFIG_FILE(), JSON.stringify(cfg, null, 2), 'utf8');
};

const defaultExportDir = () => path.join(app.getPath('documents'), 'LaLigaFantasy');
const getExportDir = () => readConfig().exportDir || defaultExportDir();

/**
 * @param {{ getMainWindow: () => Electron.BrowserWindow | null }} deps
 */
function registerAutomation({ getMainWindow }) {
    if (process.platform === 'win32') app.setAppUserModelId('com.laliga.fantasy.app');
    let dailyRunActive = isDailyRun();
    let blockerId = null;
    let quitTimer = null;

    const startDailyRunGuards = () => {
        if (blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension');
        clearTimeout(quitTimer);
        // Seguridad: si el trabajo no termina (sin sesión, sin red…), cerrar igualmente.
        quitTimer = setTimeout(() => finishDailyRun('timeout'), DAILY_RUN_TIMEOUT_MS);
    };

    const finishDailyRun = (reason) => {
        clearTimeout(quitTimer);
        if (blockerId !== null) {
            powerSaveBlocker.stop(blockerId);
            blockerId = null;
        }
        if (dailyRunActive) {
            dailyRunActive = false;
            if (reason === 'timeout' && Notification.isSupported()) {
                new Notification({
                    title: 'Informe Fantasy: no generado',
                    body: 'La app no pudo completar el trabajo diario (¿sesión caducada o sin conexión?). Ábrela para revisarlo.',
                }).show();
            }
            console.log(`[automation] daily run terminado (${reason}); cerrando app`);
            setTimeout(() => app.quit(), 3000);
        }
    };

    if (dailyRunActive) startDailyRunGuards();

    // Instancia única: si la tarea programada lanza la app estando ya abierta,
    // la instancia abierta ejecuta el trabajo (sin cerrarse después).
    const gotLock = app.requestSingleInstanceLock();
    if (!gotLock) {
        app.quit();
        return { isPrimary: false };
    }
    app.on('second-instance', (_event, argv) => {
        const win = getMainWindow();
        if (isDailyRun(argv)) {
            win?.webContents.send('automation:run-now', { source: 'scheduler' });
            return;
        }
        if (win) {
            if (win.isMinimized()) win.restore();
            win.focus();
        }
    });

    ipcMain.handle('automation:get-config', () => ({
        exportDir: getExportDir(),
        defaultExportDir: defaultExportDir(),
        isDailyRun: dailyRunActive,
    }));

    ipcMain.handle('automation:choose-export-dir', async () => {
        const result = await dialog.showOpenDialog(getMainWindow(), {
            title: 'Carpeta donde guardar el informe (p. ej. tu Google Drive)',
            defaultPath: getExportDir(),
            properties: ['openDirectory', 'createDirectory'],
        });
        if (result.canceled || !result.filePaths?.[0]) return { canceled: true, exportDir: getExportDir() };
        writeConfig({ ...readConfig(), exportDir: result.filePaths[0] });
        return { canceled: false, exportDir: result.filePaths[0] };
    });

    ipcMain.handle('automation:open-export-dir', async () => {
        const dir = getExportDir();
        fs.mkdirSync(dir, { recursive: true });
        return shell.openPath(dir);
    });

    // Escribe (sobrescribe) los archivos del informe en la carpeta de exportación.
    ipcMain.handle('automation:write-export', async (_event, files) => {
        if (!Array.isArray(files)) return { success: false, error: 'files debe ser un array' };
        const dir = getExportDir();
        try {
            fs.mkdirSync(dir, { recursive: true });
            const written = [];
            for (const f of files) {
                if (!f || !SAFE_NAME.test(f.name) || typeof f.content !== 'string') {
                    return { success: false, error: `Nombre de archivo no permitido: ${f?.name}` };
                }
                const target = path.join(dir, f.name);
                const tmp = `${target}.tmp`;
                fs.writeFileSync(tmp, f.content, 'utf8');
                fs.renameSync(tmp, target); // escritura atómica: Drive nunca sube un archivo a medias
                written.push(target);
            }
            return { success: true, dir, written };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('automation:notify', (_event, { title, body } = {}) => {
        if (!Notification.isSupported()) return false;
        const n = new Notification({ title: String(title || 'LaLiga Fantasy'), body: String(body || '') });
        n.on('click', () => {
            const win = getMainWindow();
            if (win) {
                if (win.isMinimized()) win.restore();
                win.show();
                win.focus();
            }
        });
        n.show();
        return true;
    });

    ipcMain.handle('automation:daily-run-finished', (_event, reason) => {
        finishDailyRun(reason || 'ok');
        return true;
    });

    return { isPrimary: true, isDailyRun: dailyRunActive };
}

module.exports = { registerAutomation, isDailyRun };
