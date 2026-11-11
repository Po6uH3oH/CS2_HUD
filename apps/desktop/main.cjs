const { app, BrowserWindow, Tray, Menu, nativeImage, screen, globalShortcut, dialog, shell } = require('electron');
const { WebSocket } = require('ws');
const { spawn } = require('node:child_process');
const { existsSync, mkdirSync, createWriteStream, writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '../..');
const smokeTest = process.argv.includes('--smoke-test');
const port = Number(process.env.PORT || 3190);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local HUD port');
const origin = `http://127.0.0.1:${port}`;
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
mkdirSync(dataDir, { recursive: true });
app.setPath('userData', path.join(dataDir, smokeTest ? 'desktop-test' : 'desktop'));
let overlay, studio, tray, serverProcess, selectedDisplay, lifecycleSocket, lifecycleRetry, quitting = false;
function watchLifecycle() {
  if (quitting) return;
  lifecycleSocket = new WebSocket(`${origin.replace("http:", "ws:")}/ws`);
  lifecycleSocket.on("error", () => {});
  lifecycleSocket.on("close", code => {
    if (code === 4001) { serverProcess = undefined; app.quit(); return; }
    if (!quitting) lifecycleRetry = setTimeout(watchLifecycle, 1000);
  });
}

function secureContents(window) {
  // Keep the native title stable so OBS can distinguish HUD from the studio.
  // Otherwise the shared HTML <title> replaces both BrowserWindow titles.
  window.on('page-title-updated', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(`${origin}/`) || /^https:\/\/(www\.)?twitch\.tv\/activate(?:[/?]|$)/.test(url) || (url === 'https://dev.twitch.tv/console' || url.startsWith('https://dev.twitch.tv/console/') || url === 'https://developers.faceit.com/')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${origin}/`)) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

async function serverAvailable() {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(700) });
    const value = await response.json();
    return response.ok && value.ok === true && ['live', 'demo'].includes(value.mode);
  } catch { return false; }
}

async function ensureServer() {
  if (await serverAvailable()) return;
  const runtime = path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe');
  const node = process.env.HUD_NODE || (existsSync(runtime) ? runtime : 'node');
  const output = createWriteStream(path.join(dataDir, 'desktop-server.log'), { flags: 'a' });
  serverProcess = spawn(node, ['--import', pathToFileURL(path.join(root, 'node_modules/tsx/dist/loader.mjs')).href, path.join(root, 'apps/backend/index.ts')], {
    cwd: root, windowsHide: true, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.pipe(output); serverProcess.stderr.pipe(output);
  let startupError;
  serverProcess.on('error', error => { startupError = error; });
  for (let i = 0; i < 60; i++) {
    if (startupError) throw startupError;
    if (await serverAvailable()) return;
    if (serverProcess.exitCode !== null) throw new Error('Сервер HUD завершился. Подробности: data/desktop-server.log');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Сервер HUD не ответил. Проверьте START.bat и data/desktop-server.log');
}

function placeOverlay(displayId = selectedDisplay) {
  const display = screen.getAllDisplays().find(item => item.id === displayId) || screen.getPrimaryDisplay();
  selectedDisplay = display.id;
  overlay.setBounds(display.bounds);
  overlay.setAlwaysOnTop(true, 'screen-saver');
}

function openStudio() {
  if (studio && !studio.isDestroyed()) { studio.show(); studio.focus(); return; }
  studio = new BrowserWindow({ title: 'CS2 HUD — Панель управления', width: 1360, height: 900, minWidth: 900, minHeight: 650, backgroundColor: '#101216', autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  secureContents(studio);
  studio.on('close', event => { if (!quitting) { event.preventDefault(); studio.hide(); } });
  void studio.loadURL(`${origin}/admin`);
}

function toggleOverlay() {
  if (overlay.isVisible()) overlay.hide(); else { placeOverlay(); overlay.showInactive(); }
  updateMenu();
}

function updateMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Панель управления', click: openStudio },
    { label: 'Показать HUD', type: 'checkbox', checked: overlay.isVisible(), click: toggleOverlay },
    { label: 'Монитор', submenu: screen.getAllDisplays().map((display, index) => ({ label: `${index + 1} · ${display.size.width} × ${display.size.height}`, type: 'radio', checked: selectedDisplay === display.id, click: () => { placeOverlay(display.id); updateMenu(); } })) },
    { type: 'separator' },
    { label: 'Ctrl+Shift+F10 — показать / скрыть', enabled: false },
    { label: 'Ctrl+Shift+F11 — панель', enabled: false },
    { label: 'Ctrl+Shift+F12 — закрыть HUD', enabled: false },
    { type: 'separator' },
    { label: 'Закрыть приложение', click: () => app.quit() },
  ]));
}

// Tiny original H glyph; no external assets or requests are needed for the tray.
function trayIcon() {
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4, white = y >= 7 && y <= 24 && (x >= 7 && x <= 11 || x >= 20 && x <= 24 || y >= 14 && y <= 18 && x >= 7 && x <= 24);
    pixels[i] = white ? 250 : 80; pixels[i + 1] = white ? 250 : 60; pixels[i + 2] = white ? 250 : 239; pixels[i + 3] = 255;
  }
  return nativeImage.createFromBitmap(pixels, { width: 32, height: 32, scaleFactor: 1 });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (overlay) openStudio(); });
  app.whenReady().then(async () => {
    await ensureServer();
    watchLifecycle();
    overlay = new BrowserWindow({ title: 'CS2 HUD Overlay', ...screen.getPrimaryDisplay().bounds, frame: false, transparent: true, backgroundColor: '#00000000',
      show: false, focusable: false, resizable: false, movable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    secureContents(overlay);
    overlay.setIgnoreMouseEvents(true);
    placeOverlay();
    await overlay.loadURL(`${origin}/overlay/production`);
    if (smokeTest) {
      // Electron deliberately omits alpha from getBackgroundColor(). Browser QA
      // checks CSS alpha separately; this probe checks the real native window.
      const result = { url: overlay.webContents.getURL(), backgroundRgb: overlay.getBackgroundColor(), transparentRequested: true, alwaysOnTop: overlay.isAlwaysOnTop(), focusable: overlay.isFocusable(), bounds: overlay.getBounds(), visible: overlay.isVisible(), startedServer: Boolean(serverProcess) };
      writeFileSync(path.join(dataDir, 'desktop-smoke.json'), JSON.stringify(result, null, 2));
      if (!result.alwaysOnTop || result.focusable || !result.url.endsWith('/overlay/production')) throw new Error('Desktop window configuration failed');
      app.quit(); return;
    }
    overlay.showInactive();
    tray = new Tray(trayIcon()); tray.setToolTip('CS2 HUD · Ctrl+Shift+F10'); tray.on('double-click', openStudio); updateMenu();
    for (const [shortcut, handler] of [['Control+Shift+F10', toggleOverlay], ['Control+Shift+F11', openStudio], ['Control+Shift+F12', () => app.quit()]]) {
      if (!globalShortcut.register(shortcut, handler)) console.warn(`Горячая клавиша занята: ${shortcut}. Используйте меню в трее.`);
    }
    screen.on('display-metrics-changed', () => { placeOverlay(); updateMenu(); });
    screen.on('display-removed', () => { placeOverlay(); updateMenu(); });
    screen.on('display-added', updateMenu);
    openStudio();
  }).catch(error => {
    writeFileSync(path.join(dataDir, 'desktop-error.txt'), String(error.stack || error));
    if (!smokeTest) dialog.showErrorBox('Не удалось запустить HUD', error.message);
    if (serverProcess && serverProcess.exitCode === null) serverProcess.kill();
    app.exit(1);
  });
}
app.on('before-quit', () => { quitting = true; clearTimeout(lifecycleRetry); lifecycleSocket?.close(); globalShortcut.unregisterAll(); if (serverProcess && serverProcess.exitCode === null) serverProcess.kill(); });
app.on('window-all-closed', () => { if (!tray) app.quit(); });
