const { ipcMain, app, dialog, shell, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const {
    ensureUnifiedServer,
    getServerAccessInfo,
    getUnifiedServerInstance,
} = require('./server-manager');

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'mailto:']);

// Hosts the renderer may reach through the Node-side `api-request` primitive.
// Everything else is rejected so an XSS can't use it for SSRF/token exfil.
const ALLOWED_API_HOSTS = new Set([
    'fantasy-api.llt-services.com',
    'login.laliga.es',
    'www.futbolfantasy.com',
    'futbolfantasy.com',
    'raw.githubusercontent.com',
    'github.com',
    'api.github.com',
    'objects.githubusercontent.com',
]);

// Renderer-supplied file paths must stay inside userData: tokenPersistence.js
// only ever uses fixed filenames there, so anything escaping it is hostile.
function resolveUnderUserData(filePath) {
    const base = app.getPath('userData');
    const resolved = path.resolve(String(filePath));
    if (resolved !== base && !resolved.startsWith(base + path.sep)) {
        throw new Error('Ruta fuera del directorio de datos de la aplicación');
    }
    return resolved;
}

// tokens.json -> tokens_backup.json (suffix goes before the extension, so a
// path without .json still gets a distinct backup name).
function backupPathFor(resolvedPath) {
    const { dir, name, ext } = path.parse(resolvedPath);
    return path.join(dir, `${name}_backup${ext}`);
}

function registerIpcHandlers(deps = {}) {
    const getMainWindow = deps.getMainWindow || (() => null);

    // IPC Handler to open external links (https/mailto only)
    ipcMain.handle('open-external', async (event, url) => {
        try {
            const parsed = new URL(String(url));
            if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
                return { success: false, error: `Protocolo bloqueado: ${parsed.protocol}` };
            }
            await shell.openExternal(parsed.href);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    // IPC Handler for the interactive OAuth (Google/social) login. Opens a
    // controlled child window on LaLiga's B2C authorize URL, lets the user
    // authenticate, and captures the `code` from the redirect to the app's
    // custom scheme. The renderer holds the PKCE verifier and does the token
    // exchange — this handler never sees tokens, only the short-lived code.
    ipcMain.handle('start-oauth-login', async (event, options = {}) => {
        const { authorizeUrl, redirectUri, state } = options;

        // Validate inputs before opening any window.
        let parsedAuthorize;
        try {
            parsedAuthorize = new URL(String(authorizeUrl));
        } catch (error) {
            return { success: false, error: 'URL de autorización inválida' };
        }
        if (parsedAuthorize.protocol !== 'https:' || !ALLOWED_API_HOSTS.has(parsedAuthorize.hostname)) {
            return { success: false, error: `Host de autorización no permitido: ${parsedAuthorize.hostname}` };
        }
        if (typeof redirectUri !== 'string' || !redirectUri) {
            return { success: false, error: 'redirect_uri inválido' };
        }

        const parentWindow = getMainWindow();

        return new Promise((resolve) => {
            let settled = false;
            const authWindow = new BrowserWindow({
                width: 520,
                height: 720,
                parent: parentWindow || undefined,
                modal: !!parentWindow,
                title: 'Iniciar sesión',
                autoHideMenuBar: true,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    enableRemoteModule: false,
                    sandbox: true,
                    // Fresh, isolated session so each login starts clean.
                    partition: 'oauth-login'
                }
            });

            const finish = (result) => {
                if (settled) return;
                settled = true;
                if (!authWindow.isDestroyed()) {
                    authWindow.destroy();
                }
                resolve(result);
            };

            // Inspect a candidate navigation target for the redirect_uri.
            const handleRedirect = (navEvent, url) => {
                if (typeof url !== 'string' || !url.startsWith(redirectUri)) {
                    return false;
                }
                if (navEvent && typeof navEvent.preventDefault === 'function') {
                    navEvent.preventDefault();
                }
                try {
                    const parsed = new URL(url);
                    const returnedError = parsed.searchParams.get('error');
                    if (returnedError) {
                        finish({
                            success: false,
                            error: parsed.searchParams.get('error_description') || returnedError
                        });
                        return true;
                    }
                    const code = parsed.searchParams.get('code');
                    const returnedState = parsed.searchParams.get('state');
                    if (state && returnedState !== state) {
                        finish({ success: false, error: 'State mismatch en la respuesta OAuth' });
                        return true;
                    }
                    if (code) {
                        finish({ success: true, code });
                        return true;
                    }
                    finish({ success: false, error: 'No se recibió el código de autorización' });
                } catch (error) {
                    finish({ success: false, error: error.message });
                }
                return true;
            };

            // Log every navigation (scheme+host+path only — never the query,
            // which carries the auth code) so we can see where B2C sends the
            // window: our authredirect:// (good) or e.g. miliga.laliga.com (bad).
            // Off by default; enable by running with OAUTH_DEBUG=true.
            const logNav = (label, url) => {
                if (process.env.OAUTH_DEBUG !== 'true') return;
                try {
                    const u = new URL(url);
                    console.log(`[oauth-login] ${label}: ${u.protocol}//${u.host}${u.pathname}`);
                } catch (e) {
                    console.log(`[oauth-login] ${label}: ${url}`);
                }
            };

            // Detect the failure path: if B2C rejects the redirect_uri it
            // doesn't come back to us — it bounces to LaLiga's web reply URL
            // (miliga.laliga.com), often carrying an ?error=. Catch that so the
            // window doesn't hang, and surface a useful message.
            const checkFailure = (url) => {
                try {
                    const u = new URL(url);
                    const err = u.searchParams.get('error');
                    if (err) {
                        finish({ success: false, error: u.searchParams.get('error_description') || err });
                        return true;
                    }
                    if (u.hostname === 'miliga.laliga.com') {
                        finish({
                            success: false,
                            error: 'B2C no aceptó el redirect_uri para este client_id (authredirect:// no está registrado). Se necesita el client_id de la app móvil.'
                        });
                        return true;
                    }
                } catch (e) { /* noop */ }
                return false;
            };

            authWindow.webContents.on('will-redirect', (navEvent, url) => { logNav('will-redirect', url); if (!handleRedirect(navEvent, url)) checkFailure(url); });
            authWindow.webContents.on('will-navigate', (navEvent, url) => { logNav('will-navigate', url); if (!handleRedirect(navEvent, url)) checkFailure(url); });
            authWindow.webContents.on('did-navigate', (_navEvent, url) => { logNav('did-navigate', url); checkFailure(url); });
            // The custom scheme is unregistered, so navigation to it fails —
            // catch the failed URL as a backup capture point.
            authWindow.webContents.on('did-fail-load', (_navEvent, _errorCode, _errorDesc, validatedURL) => {
                logNav('did-fail-load', validatedURL);
                handleRedirect(null, validatedURL);
            });

            authWindow.on('closed', () => {
                finish({ success: false, cancelled: true });
            });

            authWindow.loadURL(authorizeUrl).catch((error) => {
                finish({ success: false, error: error.message });
            });
        });
    });

    // IPC Handler for API requests
    ipcMain.handle('api-request', async (event, options) => {
        try {

            const { url, method = 'GET', headers = {}, data } = options;

            const parsed = new URL(String(url));
            if (parsed.protocol !== 'https:' || !ALLOWED_API_HOSTS.has(parsed.hostname)) {
                return {
                    status: 0,
                    statusText: 'Blocked',
                    headers: {},
                    data: null,
                    error: `Host no permitido: ${parsed.hostname}`
                };
            }

            const response = await axios({
                url,
                method,
                headers,
                data,
                timeout: 30000, // 30 second timeout
                validateStatus: function (status) {
                    return status >= 200 && status < 600; // Don't throw for any HTTP status
                }
            });


            return {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                data: response.data
            };
        } catch (error) {
            console.error('❌ IPC: API request failed:', error.message);
            return {
                status: error.response?.status || 0,
                statusText: error.response?.statusText || error.message,
                headers: error.response?.headers || {},
                data: error.response?.data || null,
                error: error.message
            };
        }
    });

    ipcMain.handle('get-server-addresses', async () => {
        try {
            let instance = getUnifiedServerInstance();
            if (!instance) {
                instance = await ensureUnifiedServer(deps.activeAppOrigins);
            }
            const info = getServerAccessInfo();
            const urls = Array.isArray(info?.urls) && info.urls.length
                ? info.urls
                : (instance?.url ? [instance.url] : []);
            return {
                host: info?.host ?? instance?.host ?? null,
                port: info?.port ?? instance?.port ?? null,
                urls,
            };
        } catch (error) {
            console.error('Failed to resolve server addresses:', error);
            return { host: null, port: null, urls: [] };
        }
    });

    ipcMain.handle('open-file-dialog', async () => {
        try {
            const mainWindow = getMainWindow();
            const result = await dialog.showOpenDialog(mainWindow, {
                properties: ['openFile'],
                filters: [
                    {name: 'Zip files', extensions: ['zip']},
                    {name: 'All files', extensions: ['*']}
                ]
            });

            return result;
        } catch (error) {
            console.error('❌ IPC: File dialog failed:', error);
            return {canceled: true};
        }
    });

    // Token persistence IPC handlers
    ipcMain.handle('get-app-data-path', async () => {
        try {
            const userDataPath = app.getPath('userData');
                    return userDataPath;
        } catch (error) {
            console.error('❌ Failed to get app data path:', error);
            return null;
        }
    });

    ipcMain.handle('save-persistent-file', async (event, filePath, data) => {
        let resolvedPath;
        try {
            resolvedPath = resolveUnderUserData(filePath);
        } catch (error) {
            console.error('❌ Rejected persistent-file path:', error.message);
            return false;
        }
        try {
            // Ensure directory exists
            const dir = path.dirname(resolvedPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Create backup if file exists
            if (fs.existsSync(resolvedPath)) {
                const backupPath = backupPathFor(resolvedPath);
                try {
                    fs.copyFileSync(resolvedPath, backupPath);
                } catch (backupError) {
                    console.warn('⚠️ Failed to create backup:', backupError.message);
                }
            }

            // Write file
            fs.writeFileSync(resolvedPath, data, 'utf8');
                    return true;
        } catch (error) {
            console.error('❌ Failed to save persistent file:', error);
            return false;
        }
    });

    ipcMain.handle('load-persistent-file', async (event, filePath) => {
        let resolvedPath;
        try {
            resolvedPath = resolveUnderUserData(filePath);
        } catch (error) {
            console.error('❌ Rejected persistent-file path:', error.message);
            return null;
        }
        try {
            if (!fs.existsSync(resolvedPath)) {
                return null;
            }

            const data = fs.readFileSync(resolvedPath, 'utf8');
                    return data;
        } catch (error) {
            console.error('❌ Failed to load persistent file:', error);

            // Try backup file
            const backupPath = backupPathFor(resolvedPath);
            try {
                if (fs.existsSync(backupPath)) {
                    const backupData = fs.readFileSync(backupPath, 'utf8');
                                    return backupData;
                }
            } catch (backupError) {
                console.error('❌ Backup file also failed:', backupError);
            }

            return null;
        }
    });

    ipcMain.handle('delete-persistent-file', async (event, filePath) => {
        let resolvedPath;
        try {
            resolvedPath = resolveUnderUserData(filePath);
        } catch (error) {
            console.error('❌ Rejected persistent-file path:', error.message);
            return false;
        }
        try {
            if (fs.existsSync(resolvedPath)) {
                fs.unlinkSync(resolvedPath);
                            return true;
            }
            return false;
        } catch (error) {
            console.error('❌ Failed to delete file:', error);
            return false;
        }
    });

    ipcMain.handle('file-exists', async (event, filePath) => {
        try {
            return fs.existsSync(resolveUnderUserData(filePath));
        } catch (error) {
            return false;
        }
    });
}

module.exports = {
    registerIpcHandlers,
};
