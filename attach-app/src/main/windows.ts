// This file is responsible for creating and managing the application windows, including the main window and mount popup window.

import { BrowserWindow, app } from 'electron';
import path from 'path';

let mainWindow: BrowserWindow | null = null;
let mountWindow: BrowserWindow | null = null;

export const createMainWindow = () => {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        return mainWindow;
    }

    mainWindow = new BrowserWindow({
        width: 300,
        height: 300,
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        resizable: false,
        titleBarStyle: 'hiddenInset',
        show: false, // Don't show immediately
        skipTaskbar: false,
    });

    // Load a simple HTML page for the main window
    mainWindow.loadFile(path.join(process.cwd(), 'src/renderer/main/index.html'));

    // Handle window closed - hide instead of quit
    mainWindow.on('close', (event) => {
        event.preventDefault();
        mainWindow?.hide();
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    return mainWindow;
};

export const showMainWindow = () => {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    } else {
        createMainWindow()?.show();
    }
};

export const hideMainWindow = () => {
    mainWindow?.hide();
};

export const createMountWindow = () => {
    if (mountWindow) {
        mountWindow.focus();
        return;
    }

    mountWindow = new BrowserWindow({
        width: 400,
        height: 300,
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        resizable: false,
        modal: true,
        parent: mainWindow || undefined,
    });

    mountWindow.loadFile(path.join(process.cwd(), 'src/renderer/mount/index.html'));

    mountWindow.on('closed', () => {
        mountWindow = null;
    });
};