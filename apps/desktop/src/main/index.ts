import { app, BrowserWindow, ipcMain, Menu, nativeTheme, safeStorage, session, type IpcMainInvokeEvent } from 'electron';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/**
 * Security hardening for the desktop app:
 *  - Screen capture / screenshots are blocked with setContentProtection (black window in captures).
 *  - Downloads are blocked entirely, and nothing can open new windows or navigate away.
 *  - The renderer is sandboxed, has no Node access, and uses an in-memory session
 *    (no cookies / cache / localStorage written to disk).
 *  - The only thing written to disk is the key store, encrypted with the OS keychain (safeStorage:
 *    DPAPI on Windows, Keychain on macOS, libsecret on Linux).
 */

const PARTITION = 'meetme'; // no "persist:" prefix -> in-memory session
const isDev = !app.isPackaged;

// Optional separate profile (own account + keys), e.g. MEETME_PROFILE=bob - handy for testing two users on one PC.
const profile = process.env.MEETME_PROFILE?.replace(/[^a-z0-9_-]/gi, '');
if (profile) app.setPath('userData', `${app.getPath('userData')}-${profile}`);

app.enableSandbox();
app.commandLine.appendSwitch('disable-http-cache');
if (!app.requestSingleInstanceLock()) app.quit();

// ---------------------------------------------------------------- encrypted key store

const storeDir = () => join(app.getPath('userData'), 'secure-store');
const fileFor = (key: string) => join(storeDir(), createHash('sha256').update(key).digest('hex') + '.bin');

function assertTrusted(e: IpcMainInvokeEvent) {
  const url = e.senderFrame?.url ?? '';
  const ok = url.startsWith('file://') || (isDev && !!process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL));
  if (!ok) throw new Error('untrusted sender');
}

function assertEncryption() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS encryption (keychain) is not available - refusing to store keys unencrypted');
  }
}

ipcMain.handle('store:get', async (e, key: string) => {
  assertTrusted(e);
  assertEncryption();
  try {
    return safeStorage.decryptString(await fs.readFile(fileFor(String(key))));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
});

ipcMain.handle('store:set', async (e, key: string, value: string) => {
  assertTrusted(e);
  assertEncryption();
  await fs.mkdir(storeDir(), { recursive: true });
  const file = fileFor(String(key));
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, safeStorage.encryptString(String(value)));
  await fs.rename(tmp, file); // atomic replace so a crash can't leave a half-written session
});

ipcMain.handle('store:remove', async (e, key: string) => {
  assertTrusted(e);
  await fs.rm(fileFor(String(key)), { force: true });
});

ipcMain.handle('store:clear', async (e) => {
  assertTrusted(e);
  await fs.rm(storeDir(), { recursive: true, force: true });
});

// ---------------------------------------------------------------- hardening

function hardenSession() {
  const ses = session.fromPartition(PARTITION);

  ses.on('will-download', (event) => event.preventDefault()); // never write files to disk

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    // Only camera + microphone for calls, and clipboard WRITE (admin copies a new employee's login).
    // No screen capture, no clipboard read, no notifications, nothing else.
    if (permission === 'clipboard-sanitized-write') return callback(true);
    const media = permission === 'media' && (details as { mediaTypes?: string[] }).mediaTypes;
    callback(!!media && media.every((t) => t === 'audio' || t === 'video'));
  });
  ses.setPermissionCheckHandler(
    (_wc, permission) => permission === 'media' || permission === 'clipboard-sanitized-write',
  );
  ses.setDisplayMediaRequestHandler((_req, callback) => callback({})); // deny screen sharing

  // Strip referrer, never send cookies.
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    delete details.requestHeaders['Referer'];
    delete details.requestHeaders['Cookie'];
    callback({ requestHeaders: details.requestHeaders });
  });
}

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!(isDev && process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL))) {
      event.preventDefault();
    }
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

// ---------------------------------------------------------------- window

function createWindow() {
  nativeTheme.themeSource = 'light';
  const win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 780,
    minHeight: 520,
    title: 'MeetMe',
    backgroundColor: '#f4f5f7',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: isDev,
    },
  });

  // Block screenshots & screen recording of this window (Windows 10 2004+ / macOS).
  win.setContentProtection(true);

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
    });
  }

  if (isDev && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.on('second-instance', () => {
  const w = BrowserWindow.getAllWindows()[0];
  if (w) {
    if (w.isMinimized()) w.restore();
    w.focus();
  }
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  hardenSession();
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
