"use strict";
const electron = require("electron");
const path = require("path");
function createWindow() {
  const isDev = !!process.env.VITE_DEV_SERVER_URL;
  const mainWindow = new electron.BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    frame: false,
    // Frameless window to utilize custom title bar buttons
    backgroundColor: "#080810",
    fullscreen: true,
    // Force full screen on open
    kiosk: !isDev,
    // Force kiosk mode ONLY in production
    alwaysOnTop: !isDev,
    // Prevent other windows from overlapping ONLY in production
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
  const apiUrl = process.env.CQ_API_URL || process.env.VITE_API_URL || "https://campus-quest-backend-production-8cee.up.railway.app";
  {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow.webContents.executeJavaScript(
        `window.__CQ_API_URL__ = ${JSON.stringify(apiUrl)};`
      ).catch(console.error);
    });
  }
  electron.ipcMain.on("window-minimize", () => {
    mainWindow.minimize();
  });
  electron.ipcMain.on("window-maximize", () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  electron.ipcMain.on("window-close", () => {
    mainWindow.close();
  });
  mainWindow.on("blur", () => {
    console.warn("SECURITY VIOLATION: Window lost focus");
    mainWindow.webContents.send("security-violation", "blur");
  });
  mainWindow.on("leave-full-screen", () => {
    console.warn("SECURITY VIOLATION: Exited full screen");
    mainWindow.webContents.send("security-violation", "leave-full-screen");
    mainWindow.setKiosk(true);
  });
}
electron.app.whenReady().then(() => {
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
