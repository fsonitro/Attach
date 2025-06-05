// src/main/index.ts
import { app, BrowserWindow, Tray } from 'electron';
import { createTray } from './tray';
import { createMainWindow } from './windows';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

app.on('ready', () => {
    // Create the main window
    mainWindow = createMainWindow();
    
    // Create the tray
    if (mainWindow) {
        tray = createTray(mainWindow);
    }
    
    // Show the main window initially
    mainWindow?.show();
});

// Prevent the app from quitting when all windows are closed (typical for tray apps)
app.on('window-all-closed', () => {
    // Keep the app running even when all windows are closed (tray app behavior)
});

// Handle app activation (clicking dock icon on macOS)
app.on('activate', () => {
    if (mainWindow === null) {
        mainWindow = createMainWindow();
        if (mainWindow && tray === null) {
            tray = createTray(mainWindow);
        }
    }
    mainWindow?.show();
});

// Handle before quit to properly close the app
app.on('before-quit', () => {
    // Allow the app to quit when explicitly requested
});