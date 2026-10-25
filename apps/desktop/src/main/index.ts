import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  safeStorage,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/**
 * Security hardening for the desktop app:
 *  - Screen capture / screenshots are blocked with setContentProtection (black window in captures).
 *  - Downloads are blocked entirely, and nothing can open new windows or navigate away. There is no way
 *    to save a file outside the app: files can only be shared on to other chats inside it.
 *  - The renderer is sandboxed, has no Node access, and uses an in-memory session
 *    (no cookies / cache / localStorage written to disk).
 *  - The only things written to disk are the key store, encrypted with the OS keychain (safeStorage:
 *    DPAPI on Windows, Keychain on macOS, libsecret on Linux), and saved chat media, which the app
 *    encrypts itself (with a key from that key store) before it gets here.
 */

const PARTITION = 'meetme'; // no "persist:" prefix -> in-memory session
const isDev = !app.isPackaged;

// The app was renamed MeetMe -> CellMate. Installed copies keep their old data folder (keys + login),
// which Electron would otherwise derive from the new product name.
if (app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'MeetMe'));

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

// ---------------------------------------------------------------- saved chat media (already encrypted)

const mediaDir = () => join(app.getPath('userData'), 'media');
const MAX_BLOB_BYTES = 26 * 1024 * 1024; // 25 MB attachment + encryption overhead

function blobFile(id: unknown): string {
  if (typeof id !== 'string' || !/^[0-9a-f]{32}$/.test(id)) throw new Error('invalid media id');
  return join(mediaDir(), `${id}.bin`);
}

ipcMain.handle('media:read', async (e, id: string) => {
  assertTrusted(e);
  try {
    return new Uint8Array(await fs.readFile(blobFile(id)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
});

ipcMain.handle('media:write', async (e, id: string, data: Uint8Array) => {
  assertTrusted(e);
  if (!(data instanceof Uint8Array) || data.length > MAX_BLOB_BYTES) throw new Error('invalid media file');
  const file = blobFile(id);
  await fs.mkdir(mediaDir(), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
});

ipcMain.handle('media:remove', async (e, id: string) => {
  assertTrusted(e);
  await fs.rm(blobFile(id), { force: true });
});

ipcMain.handle('media:clear', async (e) => {
  assertTrusted(e);
  await fs.rm(mediaDir(), { recursive: true, force: true });
});

// ---------------------------------------------------------------- shared locations

/**
 * "Open in Google Maps" on a location card opens the system browser - and nothing else can: the URL must be
 * exactly a Google Maps search for coordinates (core mapsUrl), so a message can't make the app open other links.
 */
const MAPS_URL = /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=-?\d{1,2}\.\d{6},-?\d{1,3}\.\d{6}$/;
ipcMain.handle('maps:open', async (e, url: string) => {
  assertTrusted(e);
  if (typeof url !== 'string' || !MAPS_URL.test(url)) throw new Error('invalid maps link');
  await shell.openExternal(url);
});

/** Server owner: the companies web page (<server>/super) in the system browser. Only that exact page. */
ipcMain.handle('super:open', async (e, serverUrl: string) => {
  assertTrusted(e);
  let page: URL;
  try {
    page = new URL('/super', serverUrl);
  } catch {
    throw new Error('invalid server address');
  }
  if (page.protocol !== 'https:' && page.protocol !== 'http:') throw new Error('invalid server address');
  await shell.openExternal(page.toString());
});

// ---------------------------------------------------------------- auto-update

// Updates come from the user's own server (https://<server>/updates/, see infra/Caddyfile), so there is no
// third-party update host. They download in the background and install when the app is next closed.
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000;
let updateFeed: string | undefined;

ipcMain.handle('updates:check', async (e, serverUrl: string) => {
  assertTrusted(e);
  if (!app.isPackaged || updateFeed || typeof serverUrl !== 'string' || !/^https:\/\/\S+$/i.test(serverUrl)) return;
  updateFeed = `${serverUrl.replace(/\/+$/, '')}/updates/`;
  autoUpdater.setFeedURL({ provider: 'generic', url: updateFeed });
  autoUpdater.on('error', (err) => console.warn('update check failed:', err.message));
  const check = () => autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  void check();
  setInterval(check, UPDATE_CHECK_MS);
});

// ---------------------------------------------------------------- hardening

function hardenSession() {
  const ses = session.fromPartition(PARTITION);

  ses.on('will-download', (event) => event.preventDefault()); // never write files to disk

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    // Only camera + microphone for calls and voice messages, clipboard WRITE (admin copies a new employee's
    // login), and location when the user taps "Share my current location". No screen capture, no clipboard
    // read, no notifications, nothing else.
    if (permission === 'clipboard-sanitized-write' || permission === 'geolocation') return callback(true);
    const media = permission === 'media' && (details as { mediaTypes?: string[] }).mediaTypes;
    callback(!!media && media.every((t) => t === 'audio' || t === 'video'));
  });
  ses.setPermissionCheckHandler(
    (_wc, permission) => permission === 'media' || permission === 'clipboard-sanitized-write' || permission === 'geolocation',
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
    title: 'CellMate',
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
