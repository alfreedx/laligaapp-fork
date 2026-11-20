/**
 * Notificaciones al móvil por Telegram (bot propio del usuario).
 *
 * - La clave del bot se guarda cifrada con safeStorage (DPAPI de Windows) en
 *   userData/fantasy-telegram.json y NUNCA se devuelve al renderer.
 * - Solo se habla con https://api.telegram.org.
 * - Los envíos de documentos solo aceptan archivos de la carpeta de exportación.
 * - Bot de comandos (/clausula…): solo se atienden mensajes del chat configurado;
 *   el resto se ignora. Los comandos se pasan al renderer, que solo consulta (lectura).
 */
const { app, ipcMain, safeStorage } = require('electron');
const fs = require('fs');
const { logEvent } = require('./automation-log');
const path = require('path');

const API = 'https://api.telegram.org';
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'fantasy-telegram.json');
const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,}$/;
const MAX_TEXT = 4000; // límite de Telegram: 4096

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

const getToken = () => {
    const { tokenEnc } = readConfig();
    if (!tokenEnc || !safeStorage.isEncryptionAvailable()) return null;
    try {
        return safeStorage.decryptString(Buffer.from(tokenEnc, 'base64'));
    } catch {
        return null;
    }
};

// Nunca incluir la URL (lleva el token) en errores o logs
const call = async (method, { json, form } = {}) => {
    const token = getToken();
    if (!token) throw new Error('Falta la clave del bot de Telegram');
    const res = await fetch(`${API}/bot${token}/${method}`, json
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) }
        : form ? { method: 'POST', body: form } : { method: 'GET' });
    let body = null;
    try { body = await res.json(); } catch { /* sin cuerpo */ }
    if (!res.ok || !body?.ok) throw new Error(`Telegram: ${body?.description || `HTTP ${res.status}`}`);
    return body.result;
};

const sendMessage = async (text) => {
    const { chatId } = readConfig();
    if (!chatId) throw new Error('Falta el chat de Telegram');
    const chunks = [];
    let rest = String(text || '');
    while (rest.length > MAX_TEXT) {
        const cut = rest.lastIndexOf('\n', MAX_TEXT);
        const at = cut > 500 ? cut : MAX_TEXT;
        chunks.push(rest.slice(0, at));
        rest = rest.slice(at);
    }
    chunks.push(rest);
    for (const chunk of chunks) {
        // eslint-disable-next-line no-await-in-loop
        await call('sendMessage', { json: { chat_id: chatId, text: chunk, parse_mode: 'HTML', disable_web_page_preview: true } });
    }
    return true;
};

const COMMANDS = [
    { command: 'clausula', description: 'Cuándo se abre la cláusula de un jugador (y alarma)' },
    { command: 'avisos', description: 'Avisos de cláusula pendientes' },
    { command: 'estado', description: 'Estado de los informes y errores recientes' },
    { command: 'ayuda', description: 'Qué puedo hacer' },
];
const MAX_MESSAGE_AGE_S = 24 * 3600;

/**
 * Escucha de comandos por long polling (getUpdates). Arranca cuando el renderer
 * lo pide (sesión iniciada) y se detiene al cerrar la app.
 */
const createBot = () => {
    let running = false;
    let paused = false;
    let offset = 0;
    let target = null; // webContents que atiende los comandos
    let lastError = null;

    const loop = async () => {
        while (running) {
            if (paused) { await new Promise((r) => setTimeout(r, 1000)); continue; }
            try {
                const updates = await call('getUpdates', { json: { offset, timeout: 25, allowed_updates: ['message'] } });
                lastError = null;
                for (const u of updates) {
                    offset = Math.max(offset, u.update_id + 1);
                    const msg = u.message;
                    const { chatId } = readConfig();
                    // Solo el chat del usuario y mensajes de texto recientes
                    if (!msg?.text || !chatId || String(msg.chat?.id) !== String(chatId)) continue;
                    if (Date.now() / 1000 - (msg.date || 0) > MAX_MESSAGE_AGE_S) continue;
                    if (target && !target.isDestroyed()) target.send('telegram:command', { text: String(msg.text).slice(0, 200), date: msg.date });
                    logEvent('info', 'bot', `comando: ${String(msg.text).slice(0, 60)}`);
                }
            } catch (error) {
                // Sin red, PC despertando, clave revocada…: reintentar más tarde (sin repetir el mismo error en el registro)
                if (error.message !== lastError) logEvent('warn', 'bot', error.message);
                lastError = error.message;
                await new Promise((r) => setTimeout(r, 30000));
            }
        }
    };

    return {
        start: async (webContents) => {
            target = webContents;
            if (running) return { success: true };
            const { chatId } = readConfig();
            if (!getToken() || !chatId) return { success: false, error: 'Telegram no está configurado' };
            running = true;
            call('setMyCommands', { json: { commands: COMMANDS } }).catch(() => {});
            loop();
            return { success: true };
        },
        stop: () => { running = false; },
        pause: (v) => { paused = v; },
    };
};

/**
 * @param {{ getExportDir: () => string }} deps
 */
function registerTelegram({ getExportDir }) {
    const bot = createBot();
    app.on('before-quit', () => bot.stop());

    ipcMain.handle('telegram:start-bot', (event) => bot.start(event.sender));
    ipcMain.handle('telegram:get-config', () => {
        const cfg = readConfig();
        return {
            hasToken: !!cfg.tokenEnc,
            chatId: cfg.chatId || null,
            chatName: cfg.chatName || null,
            encryptionAvailable: safeStorage.isEncryptionAvailable(),
        };
    });

    ipcMain.handle('telegram:set-token', (_e, token) => {
        const t = String(token || '').trim();
        if (!t) {
            const cfg = readConfig();
            delete cfg.tokenEnc;
            delete cfg.chatId;
            delete cfg.chatName;
            writeConfig(cfg);
            return { success: true };
        }
        if (!TOKEN_RE.test(t)) return { success: false, error: 'La clave no tiene el formato de un bot de Telegram (números:letras).' };
        if (!safeStorage.isEncryptionAvailable()) return { success: false, error: 'El cifrado de Windows no está disponible.' };
        writeConfig({ ...readConfig(), tokenEnc: safeStorage.encryptString(t).toString('base64') });
        return { success: true };
    });

    // Busca el chat del usuario: debe haber escrito /start a su bot justo antes
    ipcMain.handle('telegram:detect-chat', async () => {
        bot.pause(true);
        try {
            const me = await call('getMe');
            const updates = await call('getUpdates', { json: { limit: 50, timeout: 0 } });
            const msg = [...updates].reverse().map((u) => u.message || u.edited_message).find((m) => m?.chat?.type === 'private');
            if (!msg) return { success: false, error: `Abre Telegram, busca @${me.username}, pulsa Iniciar (o escribe /start) y vuelve a pulsar este botón.` };
            const chatName = [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' ') || msg.chat.username || 'tu chat';
            writeConfig({ ...readConfig(), chatId: String(msg.chat.id), chatName, botName: me.username });
            return { success: true, chatName, botName: me.username };
        } catch (error) {
            return { success: false, error: error.message };
        } finally {
            bot.pause(false);
        }
    });

    // Envía un archivo pequeño generado por la app (p. ej. evento de calendario .ics)
    ipcMain.handle('telegram:send-file', async (_e, { name, content, caption } = {}) => {
        try {
            const { chatId } = readConfig();
            if (!chatId) throw new Error('Falta el chat de Telegram');
            if (!/^[A-Za-z0-9._-]{1,80}\.ics$/.test(String(name || ''))) throw new Error('Nombre de archivo no permitido');
            if (typeof content !== 'string' || content.length > 20000) throw new Error('Contenido no válido');
            const form = new FormData();
            form.append('chat_id', chatId);
            if (caption) {
                form.append('caption', String(caption).slice(0, 1000));
                form.append('parse_mode', 'HTML');
            }
            form.append('document', new Blob([content], { type: 'text/calendar' }), name);
            await call('sendDocument', { form });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('telegram:send-message', async (_e, text) => {
        try {
            await sendMessage(text);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // Envía un archivo de la carpeta de exportación (p. ej. el PDF del informe)
    ipcMain.handle('telegram:send-document', async (_e, { name, caption } = {}) => {
        try {
            const { chatId } = readConfig();
            if (!chatId) throw new Error('Falta el chat de Telegram');
            if (!/^[A-Za-z0-9._-]{1,80}$/.test(String(name || ''))) throw new Error('Nombre de archivo no permitido');
            const file = path.join(getExportDir(), name);
            const data = fs.readFileSync(file);
            const form = new FormData();
            form.append('chat_id', chatId);
            if (caption) {
                form.append('caption', String(caption).slice(0, 1000));
                form.append('parse_mode', 'HTML');
            }
            form.append('document', new Blob([data], { type: name.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream' }), name);
            await call('sendDocument', { form });
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });
}

module.exports = { registerTelegram };
