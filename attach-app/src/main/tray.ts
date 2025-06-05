// src/main/tray.ts
import { app, Tray, Menu, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import { showMainWindow, createMountWindow } from './windows';

let tray: Tray | null = null;
let mountedShares: Map<string, any> = new Map(); // We'll update this from main process

export function createTray(mainWindow: BrowserWindow) {
    // Use template icon for better macOS integration
    const iconPath = path.join(process.cwd(), 'assets', 'icons', 'tray-icon-template.png');
    tray = new Tray(iconPath);
    
    // This makes the icon adapt to light/dark themes properly
    tray.setTitle('');

    updateTrayMenu();

    tray.setToolTip('Attach - Network Share Mounter');

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

export function updateTrayMenu(shares?: Map<string, any>) {
    if (!tray) return;
    
    if (shares) {
        mountedShares = shares;
    }

    // Build mounted drives submenu
    const mountedDrivesSubmenu: any[] = Array.from(mountedShares.values()).map(share => ({
        label: `${share.label} (${share.sharePath})`,
        submenu: [
            {
                label: 'Open in Finder',
                click: () => {
                    shell.openPath(share.mountPoint);
                }
            },
            {
                label: 'Browse Contents',
                click: () => {
                    // This could show a submenu of folder contents in the future
                    shell.openPath(share.mountPoint);
                }
            },
            { type: 'separator' },
            {
                label: `Unmount ${share.label}`,
                click: async () => {
                    try {
                        // Trigger unmount via IPC
                        const result = await ipcMain.emit('unmount-share', null, share.label);
                        console.log(`Unmount triggered for ${share.label}`);
                    } catch (error) {
                        console.error(`Failed to unmount ${share.label}:`, error);
                    }
                }
            }
        ]
    }));

    // If no mounted drives, show empty message
    if (mountedDrivesSubmenu.length === 0) {
        mountedDrivesSubmenu.push({
            label: 'No mounted drives',
            enabled: false
        });
    }

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
            submenu: mountedDrivesSubmenu
        },
        {
            label: 'Unmount All',
            enabled: mountedShares.size > 0,
            click: async () => {
                try {
                    // Emit the unmount-all event to trigger the IPC handler
                    console.log('Unmount all triggered from tray');
                    // We'll need to call this through the main process
                } catch (error) {
                    console.error('Failed to trigger unmount all:', error);
                }
            }
        },
        {
            label: 'Cleanup Orphaned Mounts',
            click: async () => {
                try {
                    console.log('Manual cleanup triggered from tray');
                    // Import the cleanup function and call it directly
                    const { cleanupOrphanedMountDirs } = require('./mount/smbService');
                    const cleanedDirs = await cleanupOrphanedMountDirs();
                    if (cleanedDirs.length > 0) {
                        console.log(`Manually cleaned up ${cleanedDirs.length} orphaned mount directories`);
                    } else {
                        console.log('No orphaned mount directories found');
                    }
                } catch (error) {
                    console.error('Failed to cleanup orphaned mounts:', error);
                }
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

    tray.setContextMenu(contextMenu);
}