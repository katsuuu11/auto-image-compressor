const { app, Tray, Menu, BrowserWindow, dialog, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let tray = null;
let logWindow = null;
let serverProcess = null;
let serverRunning = false;
const logs = [];

function pushLog(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  logs.push(line);
  if (logs.length > 500) logs.shift();
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.webContents.send('logs:update', logs.join('\n'));
  }
}

function updateTrayMenu() {
  const statusLabel = serverRunning ? '● 稼働中' : '● 停止中';
  const template = [
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    { label: '圧縮を開始', click: startServer, enabled: !serverRunning },
    { label: '圧縮を停止', click: stopServer, enabled: serverRunning },
    { type: 'separator' },
    { label: 'ログを見る', click: openLogWindow },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ];

  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function startServer() {
  if (serverProcess) return;

  const serverPath = path.join(__dirname, 'app', 'index.js');
  serverProcess = spawn(process.execPath, [serverPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  });

  serverRunning = true;
  pushLog('Compression server started on port 3000.');
  updateTrayMenu();

  serverProcess.stdout.on('data', (data) => pushLog(data.toString().trim()));
  serverProcess.stderr.on('data', (data) => pushLog(`[ERROR] ${data.toString().trim()}`));

  serverProcess.on('exit', (code, signal) => {
    pushLog(`Compression server stopped (code=${code ?? 'null'}, signal=${signal ?? 'null'}).`);
    serverProcess = null;
    serverRunning = false;
    updateTrayMenu();
  });
}

function stopServer() {
  if (!serverProcess) return;
  pushLog('Stopping compression server...');
  serverProcess.kill('SIGTERM');
}

function openLogWindow() {
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.focus();
    return;
  }

  logWindow = new BrowserWindow({
    width: 640,
    height: 480,
    title: 'ImageCompressor Logs',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  logWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  logWindow.webContents.on('did-finish-load', () => {
    logWindow.webContents.send('logs:update', logs.join('\n'));
  });
}

function initializeTray() {
  const trayIconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  const trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 18, height: 18 });
  trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip('ImageCompressor');
  tray.on('click', () => tray.popUpContextMenu());
  updateTrayMenu();
}

app.whenReady().then(() => {
  if (app.dock && typeof app.dock.hide === 'function') {
    app.dock.hide();
  }

  app.setLoginItemSettings({ openAtLogin: true });

  initializeTray();
  startServer();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

process.on('uncaughtException', (error) => {
  pushLog(`[FATAL] ${error.stack || error.message}`);
  dialog.showErrorBox('Fatal Error', error.message);
});
