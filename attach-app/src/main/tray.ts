// src/main/tray.ts
import { app, Tray, Menu, BrowserWindow } from 'electron';
import path from 'path';
import { showMainWindow, createMountWindow } from './windows';

let tray: Tray | null = null;

export function createTray(mainWindow: BrowserWindow) {
    // Use process.cwd() to get the app root directory and build absolute path
    const iconPath = path.join(process.cwd(), 'assets', 'icons', 'tray-icon.png');
    tray = new Tray(iconPath);

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show App',
            click: () => {
                showMainWindow();
            }
        },
        {
            label: 'Open Mounter',
            click: () => {
                createMountWindow();
            }
        },
        {
            label: 'Mounted Drives',
            submenu: [] // This will be populated dynamically
        },
        {
            label: 'Unmount All',
            click: () => {
                // Logic to unmount all drives
                console.log('Unmount all drives clicked');
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.quit();
            }
        }
    ]);

    tray.setToolTip('Network Share Mounter');
    tray.setContextMenu(contextMenu);

    // Show/hide main window on tray click
    tray.on('click', () => {
        if (mainWindow.isVisible()) {
            mainWindow.hide();
        } else {
            showMainWindow();
        }
    });

    return tray;
}