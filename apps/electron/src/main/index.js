import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
function createWindow() {
    const isDev = !!process.env.VITE_DEV_SERVER_URL;
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 1024,
        minHeight: 640,
        frame: false, // Frameless window to utilize custom title bar buttons
        backgroundColor: '#080810',
        fullscreen: true, // Force full screen on open
        kiosk: !isDev, // Force kiosk mode ONLY in production
        alwaysOnTop: !isDev, // Prevent other windows from overlapping ONLY in production
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    if (isDev) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    }
    // Inject Railway API URL into renderer at runtime.
    // Allows repointing the binary to a different backend by setting CQ_API_URL
    // in the launch environment (e.g., a contest-day URL change) without recompiling.
    const apiUrl = process.env.CQ_API_URL || process.env.VITE_API_URL || 'https://campus-quest-backend-production-8cee.up.railway.app';
    if (apiUrl) {
        mainWindow.webContents.once('did-finish-load', () => {
            mainWindow.webContents.executeJavaScript(`window.__CQ_API_URL__ = ${JSON.stringify(apiUrl)};`).catch(console.error);
        });
    }
    // Handle custom window controls via IPC
    ipcMain.on('window-minimize', () => {
        mainWindow.minimize();
    });
    ipcMain.on('window-maximize', () => {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        }
        else {
            mainWindow.maximize();
        }
    });
    ipcMain.on('window-close', () => {
        mainWindow.close();
    });
    // Security Monitoring Features
    mainWindow.on('blur', () => {
        console.warn('SECURITY VIOLATION: Window lost focus');
        mainWindow.webContents.send('security-violation', 'blur');
    });
    mainWindow.on('leave-full-screen', () => {
        console.warn('SECURITY VIOLATION: Exited full screen');
        mainWindow.webContents.send('security-violation', 'leave-full-screen');
        // Force back to kiosk mode for assessment
        mainWindow.setKiosk(true);
    });
}
app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
//# sourceMappingURL=index.js.map