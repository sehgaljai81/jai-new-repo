import { app, BrowserWindow, session, protocol, net } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { registerAllHandlers, loadEnv } from './ipc/handlers';
import { logger } from './logger';
import * as authService from './services/auth';
import { IPC_CHANNELS } from '../shared/types';

const DEEP_LINK_SCHEME = 'neo-app';
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

let pendingDeepLinkUrl: string | null = null;

function getDevRendererUrl(): string {
  const url = process.env.NEO_DEV_RENDERER_URL;
  if (!url) {
    throw new Error('NEO_DEV_RENDERER_URL is not set');
  }
  return url;
}

function registerAppProtocol(): void {
  const outDir = path.join(app.getAppPath(), 'out');

  protocol.handle('app', (request) => {
    const urlPath = new URL(request.url).pathname;
    let filePath = path.join(outDir, urlPath);

    if (!path.extname(filePath)) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      filePath = path.join(outDir, 'index.html');
    }

    return net.fetch(`file://${filePath}`);
  });
}

function registerDeepLinkProtocol(): void {
  if (isDev && process.platform === 'win32' && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }
}

/** Find the first `neo-app://` URL in an argv array. */
function extractDeepLinkFromArgv(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`)) ?? null;
}

/** Log a URL with the `token` param redacted to length + 6-char prefix. */
function safeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const t = u.searchParams.get('token');
    if (t) {
      u.searchParams.set('token', `<redacted len=${t.length} prefix=${t.slice(0, 6)}>`);
    }
    return u.toString();
  } catch {
    return rawUrl;
  }
}


function handleDeepLinkUrl(rawUrl: string): void {
  logger.info(`[Auth] Received deep-link callback url=${safeUrl(rawUrl)}`);

  if (!mainWindow || mainWindow.webContents.isLoading()) {
    logger.info('[Auth] Window not ready — queuing deep-link until load');
    pendingDeepLinkUrl = rawUrl;
    return;
  }

  try {
    const { token, refreshToken } = authService.consumeCallback(rawUrl);
    mainWindow.webContents.send(IPC_CHANNELS.AUTH_TOKEN_RECEIVED, {
      token,
      refreshToken,
    });
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Login failed';
    logger.warn('[Auth] Deep-link rejected:', message);
    mainWindow.webContents.send(IPC_CHANNELS.AUTH_ERROR, message);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Neo App',
    backgroundColor: '#0d1117',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  registerAllHandlers(mainWindow);

  if (isDev) {
    mainWindow.loadURL(`${getDevRendererUrl()}/login`);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL('app://./login');
  }

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingDeepLinkUrl) {
      const url = pendingDeepLinkUrl;
      pendingDeepLinkUrl = null;
      handleDeepLinkUrl(url);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/** Restrict navigation and new windows to known-good origins. */
function setupSecurity(): void {
  const allowedOrigins = isDev ? [getDevRendererUrl(), 'app://'] : ['app://'];

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      const isAllowed =
        allowedOrigins.some((origin) => url.startsWith(origin)) ||
        url.startsWith('file://');
      if (!isAllowed) {
        logger.warn('[Security] Blocked navigation to:', url);
        event.preventDefault();
      }
    });

    contents.setWindowOpenHandler(({ url }) => {
      const isAllowed = allowedOrigins.some((origin) => url.startsWith(origin));
      return isAllowed ? { action: 'allow' } : { action: 'deny' };
    });
  });

  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self' app:; script-src 'self' app: 'unsafe-inline' 'unsafe-eval'; style-src 'self' app: 'unsafe-inline'; font-src 'self' app: data:; img-src 'self' app: data: blob:; connect-src *;",
          ],
        },
      });
    });
  }
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: false,
    },
  },
]);

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const url = extractDeepLinkFromArgv(argv);
    if (url) {
      handleDeepLinkUrl(url);
    }
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLinkUrl(url);
  });

  app.whenReady().then(() => {
    loadEnv();

    if (!isDev) {
      registerAppProtocol();
    }
    registerDeepLinkProtocol();
    setupSecurity();
    createWindow();

    const coldStartUrl = extractDeepLinkFromArgv(process.argv);
    if (coldStartUrl) {
      pendingDeepLinkUrl = coldStartUrl;
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
