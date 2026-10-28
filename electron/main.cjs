const { app, BrowserWindow, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs");

let mainWindow;
app.setAsDefaultProtocolClient("channelflow");

function loadRuntimeEnv() {
  const candidates = [path.join(process.resourcesPath, "oauth.env"), path.join(app.getPath("userData"), ".env")];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
    }
  }
}

async function startApi() {
  loadRuntimeEnv();
  if (app.isPackaged) {
    process.env.FFMPEG_PATH = path.join(process.resourcesPath, "bin", "ffmpeg.exe");
    process.env.FFPROBE_PATH = path.join(process.resourcesPath, "bin", "ffprobe.exe");
  }
  const serverPath = app.isPackaged ? path.join(app.getAppPath(), "server", "server.mjs") : path.join(__dirname, "..", "server", "server.mjs");
  await import(`file:///${serverPath.replace(/\\/g, "/")}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({ width: 1280, height: 820, minWidth: 1050, minHeight: 700, title: "ChannelFlow", webPreferences: { contextIsolation: true, sandbox: true } });
  mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
}

app.requestSingleInstanceLock();
app.whenReady().then(async () => {
  await startApi();
  createWindow();
  if (app.isPackaged) autoUpdater.checkForUpdatesAndNotify().catch(() => {});
});
app.on("window-all-closed", () => app.quit());
app.on("second-instance", (_event, argv) => {
  if (argv.some(arg => arg.startsWith("channelflow://"))) mainWindow?.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  mainWindow?.show(); mainWindow?.focus();
});
