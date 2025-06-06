// This file is responsible for creating and managing the application windows, including the main window and mount popup window.

import { BrowserWindow, app } from 'electron';
import path from 'path';
import fs from 'fs';

let mainWindow: BrowserWindow | null = null;
let mountWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

// Helper function to get the correct path for different environments
function getResourcePath(relativePath: string): string {
    if (app.isPackaged) {
        // In packaged app, resources are in the app bundle
        return path.join(process.resourcesPath, 'app.asar.unpacked', relativePath);
    } else {
        // In development, use the source path
        return path.join(process.cwd(), relativePath);
    }
}

function getRendererPath(htmlPath: string): string {
    let resolvedPath: string;
    if (app.isPackaged) {
        // In packaged app, __dirname is /dist/main inside asar, HTML files are at /src/
        resolvedPath = path.join(__dirname, '..', '..', 'src', htmlPath);
    } else {
        // In development, use the source path
        resolvedPath = path.join(process.cwd(), 'src', htmlPath);
    }
    
    console.log(`getRendererPath: htmlPath=${htmlPath}, __dirname=${__dirname}, app.isPackaged=${app.isPackaged}, resolvedPath=${resolvedPath}`);
    return resolvedPath;
}

export const createMainWindow = () => {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
        return mainWindow;
    }

    const preloadPath = app.isPackaged 
        ? path.join(__dirname, '../preload/index.js')
        : path.join(process.cwd(), 'dist/preload/index.js');
    
    console.log(`Main window preload path: ${preloadPath}`);
    console.log(`Preload file exists: ${fs.existsSync(preloadPath)}`);

    mainWindow = new BrowserWindow({
        width: 400,
        height: 450,
        webPreferences: {
            preload: preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
        },
        resizable: false, // Disable resizing since no maximize button
        frame: true, // Enable native frame with controls
        transparent: false, // Disable transparency for native look
        titleBarStyle: 'default',
        show: false, // Start hidden for smooth entrance animation
        skipTaskbar: false,
        vibrancy: 'sidebar', // More subtle vibrancy for native windows
        visualEffectState: 'active',
        title: 'Attach - Network Share Mounter',
        minimizable: true,
        maximizable: false, // Disable maximize button
        closable: true,
    });

    // Load a simple HTML page for the main window
    mainWindow.loadFile(getRendererPath('renderer/main/index.html'));

    // Show window with smooth entrance animation
    mainWindow.once('ready-to-show', () => {
        mainWindow?.show();
        
        // Add entrance animation
        mainWindow?.setOpacity(0);
        let opacity = 0;
        const fadeIn = setInterval(() => {
            opacity += 0.1;
            mainWindow?.setOpacity(opacity);
            if (opacity >= 1) {
                clearInterval(fadeIn);
            }
        }, 20);
    });

    // Handle window closed - hide instead of quit on normal close, but allow force quit
    mainWindow.on('close', (event) => {
        if (!(global as any).isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
        }
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

export const quitApplication = () => {
    (global as any).isQuitting = true;
    if (mainWindow) {
        mainWindow.destroy();
    }
    app.quit();
};

export const createMountWindow = () => {
    if (mountWindow) {
        mountWindow.focus();
        return;
    }

    mountWindow = new BrowserWindow({
        width: 500,
        height: 500,
        webPreferences: {
            preload: app.isPackaged 
                ? path.join(__dirname, '../preload/index.js')
                : path.join(process.cwd(), 'dist/preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        resizable: false,
        frame: true, // Enable native frame
        transparent: false,
        modal: true,
        parent: mainWindow || undefined,
        show: false, // Start hidden for animation
        vibrancy: 'sidebar',
        visualEffectState: 'active',
        title: 'Mount Network Share',
        minimizable: false,
        maximizable: false,
        closable: true,
    });

    mountWindow.loadFile(getRendererPath('renderer/mount/index.html'));

    // Show with animation
    mountWindow.once('ready-to-show', () => {
        mountWindow?.show();
        
        // Scale entrance animation
        mountWindow?.setOpacity(0);
        let scale = 0.8;
        let opacity = 0;
        const animate = setInterval(() => {
            scale += 0.02;
            opacity += 0.1;
            mountWindow?.setOpacity(opacity);
            // Note: setSize for scale effect would need bounds calculation
            if (opacity >= 1 && scale >= 1) {
                clearInterval(animate);
            }
        }, 16); // ~60fps
    });

    mountWindow.on('closed', () => {
        mountWindow = null;
    });
};

export const createSettingsWindow = () => {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 700,
        height: 600,
        webPreferences: {
            preload: app.isPackaged 
                ? path.join(__dirname, '../preload/index.js')
                : path.join(process.cwd(), 'dist/preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        resizable: false,
        frame: true,
        transparent: false,
        modal: true,
        parent: mainWindow || undefined,
        show: false,
        vibrancy: 'sidebar',
        visualEffectState: 'active',
        title: 'Attach Settings',
        minimizable: false,
        maximizable: false,
        closable: true,
    });

    settingsWindow.loadFile(getRendererPath('renderer/settings/index.html'));

    // Show with animation
    settingsWindow.once('ready-to-show', () => {
        settingsWindow?.show();
        
        // Fade entrance animation
        settingsWindow?.setOpacity(0);
        let opacity = 0;
        const fadeIn = setInterval(() => {
            opacity += 0.1;
            settingsWindow?.setOpacity(opacity);
            if (opacity >= 1) {
                clearInterval(fadeIn);
            }
        }, 20);
    });

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
};