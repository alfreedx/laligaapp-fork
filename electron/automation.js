/**
 * Automatización diaria (fork): carpeta de exportación del informe,
 * escritura de archivos, notificaciones y modo `--daily-run` (lanzado por
 * el Programador de tareas de Windows a las 19:05).
 */
const { app, ipcMain, dialog, shell, Notification, powerSaveBlocker, BrowserWindow, session } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = () => path.join(app.getPath('userData'), 'fantasy-automation.json');
const SAFE_NAME = /^[A-Za-z0-9._-]{1,80}$/;
const DAILY_RUN_FLAG = '--daily-run';
const MATCHDAY_FLAG = '--matchday'; // con --daily-run: solo el resumen de inicio de jornada
const ALERTS_FLAG = '--alerts';     // con --daily-run: solo los avisos de cláusula
const BACKTEST_FLAG = '--backtest'; // con --daily-run: backtest del xP (solo lectura)
const MATCHDAY_TASK = 'LaLigaFantasy - Inicio de jornada';
const REMINDERS_TASK = 'LaLigaFantasy - Avisos de cláusula';
const DAILY_RUN_TIMEOUT_MS = 10 * 60 * 1000;
const PDF_PARTITION = 'pdf-render'; // sin "persist:" → sesión en memoria, aislada

const isDailyRun = (argv = process.argv) => argv.includes(DAILY_RUN_FLAG);
const runMode = (argv = process.argv) => {
    if (argv.includes(MATCHDAY_FLAG)) return 'matchday';
    if (argv.includes(ALERTS_FLAG)) return 'alerts';
    if (argv.includes(BACKTEST_FLAG)) return 'backtest';
    return 'report';
};

/**
 * Crea (o sustituye) una tarea de Windows con disparadores de un solo uso que
 * abre la app con `--daily-run <modo>` y despierta el equipo. Sin horas, la elimina.
 * Los valores van por variables de entorno: nunca se interpolan en el script.
 */
const scheduleOnceTask = (taskName, mode, whens) => new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ success: false, error: 'Solo disponible en Windows' });
    if (!app.isPackaged) return resolve({ success: false, error: 'Solo en la app instalada (no en modo desarrollo)' });
    const p = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
    const local = whens.map(fmt).join(',');
    const script = !whens.length
        ? "Unregister-ScheduledTask -TaskName $env:LLF_TASK -Confirm:$false -ErrorAction SilentlyContinue"
        : [
        "$ErrorActionPreference = 'Stop'",
        "$ats = $env:LLF_AT -split ',' | ForEach-Object { [datetime]::ParseExact($_, 'yyyy-MM-ddTHH:mm:ss', [Globalization.CultureInfo]::InvariantCulture) }",
        "$a = New-ScheduledTaskAction -Execute $env:LLF_EXE -Argument ('--daily-run ' + $env:LLF_MODE) -WorkingDirectory (Split-Path $env:LLF_EXE)",
        '$t = @($ats | ForEach-Object { New-ScheduledTaskTrigger -Once -At $_ })',
        '$s = New-ScheduledTaskSettingsSet -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew',
        "$p = New-ScheduledTaskPrincipal -UserId ($env:USERDOMAIN + '\\' + $env:USERNAME) -LogonType Interactive -RunLevel Limited",
        "Register-ScheduledTask -TaskName $env:LLF_TASK -Action $a -Trigger $t -Settings $s -Principal $p -Force -Description 'LaLiga Fantasy (fork): resumen de jornada o avisos de cláusula; despierta el equipo.' | Out-Null",
    ].join('; ');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
        env: { ...process.env, LLF_EXE: process.execPath, LLF_AT: local, LLF_TASK: taskName, LLF_MODE: mode },
        windowsHide: true,
        timeout: 30000,
    }, (error, _stdout, stderr) => {
        if (error) resolve({ success: false, error: String(stderr || error.message).trim().slice(0, 300) });
        else resolve({ success: true, at: local });
    });
});

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
            win?.webContents.send('automation:run-now', { source: 'scheduler', mode: runMode(argv) });
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
        dailyRunMode: runMode(),
    }));

    ipcMain.handle('automation:schedule-matchday-summary', async (_event, at) => {
        const when = new Date(String(at || ''));
        const t = when.getTime();
        if (!Number.isFinite(t) || t <= Date.now() || t - Date.now() > 14 * 24 * 3600 * 1000) {
            return { success: false, error: 'Fecha no válida' };
        }
        return scheduleOnceTask(MATCHDAY_TASK, MATCHDAY_FLAG, [when]);
    });

    // Avisos pedidos con /clausula: una tarea con un disparador por aviso (sustituye a la anterior)
    ipcMain.handle('automation:schedule-clause-reminders', async (_event, times) => {
        if (!Array.isArray(times) || times.length > 30) return { success: false, error: 'Lista no válida' };
        const now = Date.now();
        const whens = times.map((t) => new Date(String(t)))
            .filter((d) => Number.isFinite(d.getTime()) && d.getTime() > now && d.getTime() - now < 30 * 24 * 3600 * 1000)
            .sort((x, y) => x - y);
        return scheduleOnceTask(REMINDERS_TASK, ALERTS_FLAG, whens);
    });

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

    // Imprime HTML a PDF en una ventana oculta sin JavaScript y lo guarda en la carpeta de exportación.
    ipcMain.handle('automation:write-pdf', async (_event, { name, html } = {}) => {
        if (!SAFE_NAME.test(String(name || '')) || !String(name).toLowerCase().endsWith('.pdf') || typeof html !== 'string') {
            return { success: false, error: 'Parámetros de PDF no válidos' };
        }
        let win = null;
        try {
            win = new BrowserWindow({
                show: false,
                width: 1400,
                height: 1000,
                // Sesión propia y no persistente: el bloqueo de red NO afecta a la ventana principal
                webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: PDF_PARTITION },
            });
            // Bloquear cualquier recurso externo: solo el propio documento
            session.fromPartition(PDF_PARTITION).webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_d, cb) => cb({ cancel: true }));
            await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
            const pdf = await win.webContents.printToPDF({
                landscape: false, // A4 vertical: más cómodo en el móvil
                pageSize: 'A4',
                printBackground: true,
                preferCSSPageSize: true,
                margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
            });
            const dir = getExportDir();
            fs.mkdirSync(dir, { recursive: true });
            const target = path.join(dir, name);
            const tmp = `${target}.tmp`;
            fs.writeFileSync(tmp, pdf);
            fs.renameSync(tmp, target);
            return { success: true, path: target };
        } catch (error) {
            return { success: false, error: error.message };
        } finally {
            if (win && !win.isDestroyed()) win.destroy();
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

module.exports = { registerAutomation, isDailyRun, getExportDir };
