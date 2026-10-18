const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

function createWindow() {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: 'JARVIS',
    backgroundColor: '#050b16',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  window.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Only named, allowlisted applications can be launched; arbitrary shell commands are not exposed.
ipcMain.handle('open-app', async (_event, appName) => {
  const key = String(appName || '').toLowerCase();
  const macApps = { chrome: 'Google Chrome', vscode: 'Visual Studio Code', finder: 'Finder', safari: 'Safari' };
  const windowsApps = { chrome: 'chrome', vscode: 'code', explorer: 'explorer', edge: 'msedge' };

  try {
    if (process.platform === 'darwin') {
      const target = macApps[key];
      if (!target) return { ok: false, message: 'This app is not in the safe allowlist.' };
      spawn('open', ['-a', target], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      const target = windowsApps[key];
      if (!target) return { ok: false, message: 'This app is not in the safe allowlist.' };
      spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else {
      return { ok: false, message: 'This starter currently supports macOS and Windows.' };
    }
    return { ok: true, message: 'Opening ' + key + '…' };
  } catch {
    return { ok: false, message: 'Could not open that app. Check that it is installed.' };
  }
});

ipcMain.handle('open-url', async (_event, url) => {
  try {
    const parsed = new URL(String(url));
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return { ok: false, message: 'Only HTTP and HTTPS URLs are allowed.' };
    }
    await shell.openExternal(parsed.toString());
    return { ok: true, message: 'Opening website…' };
  } catch {
    return { ok: false, message: 'Enter a valid website URL.' };
  }
});
