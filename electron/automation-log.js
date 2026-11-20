/**
 * Registro de la automatización (informes, bot, avisos, tareas programadas) en
 * userData/fantasy-data/automation.log. Nunca lanza excepciones: si no puede
 * escribir, se pierde la línea y la app sigue. Rota a los 512 KB (se guarda un .1).
 */
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 512 * 1024;
const LEVELS = new Set(['info', 'warn', 'error']);
const logFile = () => path.join(app.getPath('userData'), 'fantasy-data', 'automation.log');

// Nunca registrar secretos: tokens de bot (123:abc…) ni cabeceras Bearer
const redact = (s) => String(s ?? '')
    .replace(/\b\d{5,15}:[A-Za-z0-9_-]{30,}\b/g, '[token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [token]')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 500);

const logEvent = (level, source, message) => {
    try {
        const file = logFile();
        fs.mkdirSync(path.dirname(file), { recursive: true });
        try {
            if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, `${file}.1`);
        } catch { /* aún no existe */ }
        const lvl = LEVELS.has(level) ? level : 'info';
        fs.appendFileSync(file, `${new Date().toISOString()} ${lvl.toUpperCase()} [${redact(source).slice(0, 40)}] ${redact(message)}\n`, 'utf8');
    } catch { /* el registro nunca rompe la app */ }
};

const readLog = (lines = 50) => {
    try {
        const all = fs.readFileSync(logFile(), 'utf8').trim().split('\n');
        return all.slice(-Math.max(1, Math.min(500, lines)));
    } catch {
        return [];
    }
};

module.exports = { logEvent, readLog };
