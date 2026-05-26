const { app, Tray, Menu, BrowserWindow, dialog, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const chokidar = require('chokidar');
const Store = require('electron-store');

const store = new Store({
  name: 'settings',
  defaults: {
    watchedFolders: [],
  },
});

let tray = null;
let logWindow = null;
let serverProcess = null;
let serverRunning = false;
const logs = [];
const folderWatchers = new Map();
const processingFiles = new Set();
const WATCHED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function pushLog(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  logs.push(line);
  if (logs.length > 500) logs.shift();
  if (logWindow && !logWindow.isDestroyed()) {
    logWindow.webContents.send('logs:update', logs.join('\n'));
  }
}

function getWatchedFolders() {
  return store.get('watchedFolders', []);
}

function setWatchedFolders(folders) {
  store.set('watchedFolders', folders);
}

async function postToServer(endpoint, filePath) {
  try {
    const response = await fetch(`http://localhost:3000${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filePath }),
    });

    const json = await response.json();
    if (!response.ok) {
      throw new Error(json.error || `HTTP ${response.status}`);
    }

    pushLog(`${endpoint} succeeded: ${filePath}`);
  } catch (error) {
    pushLog(`[ERROR] ${endpoint} failed: ${filePath} (${error.message})`);
  }
}

async function handleDetectedFile(filePath) {
  if (processingFiles.has(filePath)) return;
  processingFiles.add(filePath);

  const ext = path.extname(filePath).toLowerCase();
  if (WATCHED_IMAGE_EXTENSIONS.has(ext)) {
    await postToServer('/compress', filePath);
  } else if (ext === '.zip') {
    await postToServer('/extract', filePath);
  }

  processingFiles.delete(filePath);
}

function startWatchingFolder(folderPath) {
  if (folderWatchers.has(folderPath)) return;

  const watcher = chokidar.watch(folderPath, {
    ignored: /(^|[\/\\])\../,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 100,
    },
  });

  watcher.on('add', (filePath) => {
    pushLog(`Detected new file: ${filePath}`);
    handleDetectedFile(filePath);
  });

  watcher.on('error', (error) => {
    pushLog(`[ERROR] Watcher error (${folderPath}): ${error.message}`);
  });

  folderWatchers.set(folderPath, watcher);
  pushLog(`Started watching folder: ${folderPath}`);
}

function stopWatchingFolder(folderPath) {
  const watcher = folderWatchers.get(folderPath);
  if (!watcher) return;

  watcher.close();
  folderWatchers.delete(folderPath);
  pushLog(`Stopped watching folder: ${folderPath}`);
}

function syncFolderWatchers() {
  const savedFolders = new Set(getWatchedFolders());

  for (const existingFolder of folderWatchers.keys()) {
    if (!savedFolders.has(existingFolder)) {
      stopWatchingFolder(existingFolder);
    }
  }

  for (const folderPath of savedFolders) {
    startWatchingFolder(folderPath);
  }
}

async function addWatchedFolder() {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: '監視するフォルダを選択',
  });

  if (result.canceled || result.filePaths.length === 0) return;

  const [selectedFolder] = result.filePaths;
  const folders = getWatchedFolders();

  if (folders.includes(selectedFolder)) {
    pushLog(`Folder is already watched: ${selectedFolder}`);
    return;
  }

  const updated = [...folders, selectedFolder];
  setWatchedFolders(updated);
  startWatchingFolder(selectedFolder);
  updateTrayMenu();
}

function removeWatchedFolder(folderPath) {
  const updatedFolders = getWatchedFolders().filter((folder) => folder !== folderPath);
  setWatchedFolders(updatedFolders);
  stopWatchingFolder(folderPath);
  updateTrayMenu();
}

function clearWatchedFolders() {
  for (const folder of getWatchedFolders()) {
    stopWatchingFolder(folder);
  }
  setWatchedFolders([]);
  updateTrayMenu();
}

function createWatchedFolderManagementSubmenu() {
  const folders = getWatchedFolders();

  if (folders.length === 0) {
    return [{ label: '監視フォルダはありません', enabled: false }];
  }

  return [
    ...folders.map((folderPath) => ({
      label: `削除: ${folderPath}`,
      click: () => removeWatchedFolder(folderPath),
    })),
    { type: 'separator' },
    { label: 'すべての監視を解除', click: clearWatchedFolders },
  ];
}

function updateTrayMenu() {
  const statusLabel = serverRunning ? '● 稼働中' : '● 停止中';
  const template = [
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    { label: '圧縮を開始', click: startServer, enabled: !serverRunning },
    { label: '圧縮を停止', click: stopServer, enabled: serverRunning },
    { type: 'separator' },
    { label: '監視フォルダを追加', click: addWatchedFolder },
    { label: '監視フォルダを管理', submenu: createWatchedFolderManagementSubmenu() },
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
  syncFolderWatchers();
  startServer();
});

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }

  for (const watcher of folderWatchers.values()) {
    watcher.close();
  }
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
});

process.on('uncaughtException', (error) => {
  pushLog(`[FATAL] ${error.stack || error.message}`);
  dialog.showErrorBox('Fatal Error', error.message);
});
