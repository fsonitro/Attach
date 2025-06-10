// About window JavaScript
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for CSS to be fully applied to prevent layout shifts
    await new Promise(resolve => {
        if (document.readyState === 'complete') {
            resolve();
        } else {
            window.addEventListener('load', resolve);
        }
    });

    // Get DOM elements
    const closeBtn = document.getElementById('closeBtn');
    const appVersionElement = document.getElementById('appVersion');
    const currentYearElement = document.getElementById('currentYear');

    // Set current year
    currentYearElement.textContent = new Date().getFullYear().toString();

    // Set the version
    appVersionElement.textContent = 'Version 0.0.9';

    // Fix icon path
    await fixIconPath();

    // Set up event listeners
    setupEventListeners();

    async function fixIconPath() {
        const appIcon = document.getElementById('appIcon');
        if (appIcon) {
            try {
                // Try to get the correct asset path from the main process
                if (window.api && window.api.getSystemInfo) {
                    const systemInfo = await window.api.getSystemInfo();
                    if (systemInfo.assetsPath) {
                        const iconPath = `file://${systemInfo.assetsPath}/icons/folders-icon.svg`;
                        appIcon.src = iconPath;
                        return;
                    }
                }
            } catch (error) {
                console.warn('Could not get assets path from main process:', error);
            }
            
            // Fallback: try multiple relative paths
            const fallbackPaths = [
                '../../../assets/icons/folders-icon.svg',
                '../../../assets/icons/folders.png',
                '../../../assets/icons/folders-tray.png'
            ];
            
            for (const fallbackPath of fallbackPaths) {
                try {
                    // Test if the path works by creating a new image
                    const testImg = new Image();
                    testImg.onload = () => {
                        appIcon.src = fallbackPath;
                    };
                    testImg.onerror = () => {
                        // Continue to next fallback
                    };
                    testImg.src = fallbackPath;
                    break;
                } catch (error) {
                    console.warn(`Failed to load icon from ${fallbackPath}:`, error);
                }
            }
        }
    }

    function setupEventListeners() {
        // Close button
        closeBtn?.addEventListener('click', closeWindow);

        // Keyboard shortcuts
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                closeWindow();
            } else if ((event.metaKey || event.ctrlKey) && event.key === 'w') {
                event.preventDefault();
                closeWindow();
            }
        });
    }

    async function closeWindow() {
        try {
            if (window.api && window.api.closeAboutWindow) {
                await window.api.closeAboutWindow();
            }
        } catch (error) {
            console.error('Failed to close window:', error);
            // Fallback: try to close the window
            if (window.close) {
                window.close();
            }
        }
    }

    // Add some visual enhancements
    const appIcon = document.getElementById('appIcon');
    if (appIcon) {
        // Add error handling for icon loading
        appIcon.addEventListener('error', (e) => {
            console.warn('Failed to load app icon:', appIcon.src);
            // Try alternative paths or provide a fallback
            const fallbackPaths = [
                '../../../assets/icons/folders.png',
                '../../../assets/icons/folders-tray.png',
                'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjgwIiBoZWlnaHQ9IjgwIiByeD0iMTYiIGZpbGw9IiMwMDdhZmYiLz4KPHN2ZyB4PSIyMCIgeT0iMjAiIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJ3aGl0ZSI+CjxwYXRoIGQ9Ik0xMCA0SDE0QTE0IDE0IDAgMCAxIDE0IDRWMTJBNCA0IDAgMCAxIDEwIDEySCA0VjZBMiAyIDAgMCAxIDYgNEgxMFoiLz4KPC9zdmc+Cjwvc3ZnPg=='
            ];
            
            const currentSrc = appIcon.src;
            
            // Find next fallback that hasn't been tried
            for (const fallbackPath of fallbackPaths) {
                if (!currentSrc.includes(fallbackPath)) {
                    console.log('Trying fallback icon:', fallbackPath);
                    appIcon.src = fallbackPath;
                    break;
                }
            }
        });

        // Add a subtle bounce animation on load
        appIcon.addEventListener('load', () => {
            console.log('Icon loaded successfully:', appIcon.src);
            setTimeout(() => {
                appIcon.style.transform = 'scale(1.1)';
                setTimeout(() => {
                    appIcon.style.transform = 'scale(1)';
                }, 200);
            }, 300);
        });
    }
});
