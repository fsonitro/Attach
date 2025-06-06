// Settings window JavaScript
document.addEventListener('DOMContentLoaded', async () => {
    // Get all form elements
    const elements = {
        startAtLogin: document.getElementById('startAtLogin'),
        rememberCredentials: document.getElementById('rememberCredentials'),
        autoMountEnabled: document.getElementById('autoMountEnabled'),
        networkWatcherEnabled: document.getElementById('networkWatcherEnabled'),
        checkInterval: document.getElementById('checkInterval'),
        retryAttempts: document.getElementById('retryAttempts'),
        retryDelay: document.getElementById('retryDelay'),
        mountLocation: document.getElementById('mountLocation'),
        browseMountLocation: document.getElementById('browseMountLocation'),
        manageConnections: document.getElementById('manageConnections'),
        clearAllData: document.getElementById('clearAllData'),
        resetDefaults: document.getElementById('resetDefaults'),
        cancelBtn: document.getElementById('cancelBtn'),
        saveBtn: document.getElementById('saveBtn'),
        statusMessage: document.getElementById('statusMessage')
    };

    // Store original settings for comparison
    let originalSettings = {};
    let currentSettings = {};

    // Load settings on startup
    await loadSettings();

    // Set up event listeners
    setupEventListeners();

    async function loadSettings() {
        try {
            // Load all settings from main process
            const settings = await window.api.getAllSettings();
            originalSettings = { ...settings };
            currentSettings = { ...settings };

            // Populate form with current settings
            elements.startAtLogin.checked = settings.startAtLogin;
            elements.rememberCredentials.checked = settings.rememberCredentials;
            elements.autoMountEnabled.checked = settings.autoMountEnabled;
            elements.networkWatcherEnabled.checked = settings.networkWatcher.enabled;
            elements.checkInterval.value = settings.networkWatcher.checkInterval;
            elements.retryAttempts.value = settings.networkWatcher.retryAttempts;
            elements.retryDelay.value = settings.networkWatcher.retryDelay;
            elements.mountLocation.value = settings.mountLocation;

            // Update network settings visibility
            updateNetworkSettingsVisibility();

        } catch (error) {
            console.error('Failed to load settings:', error);
            showStatus('Failed to load settings', 'error');
        }
    }

    function setupEventListeners() {
        // Checkbox change handlers
        elements.startAtLogin.addEventListener('change', handleSettingChange);
        elements.rememberCredentials.addEventListener('change', handleSettingChange);
        elements.autoMountEnabled.addEventListener('change', handleSettingChange);
        elements.networkWatcherEnabled.addEventListener('change', (e) => {
            handleSettingChange(e);
            updateNetworkSettingsVisibility();
        });

        // Number input change handlers
        elements.checkInterval.addEventListener('change', handleSettingChange);
        elements.retryAttempts.addEventListener('change', handleSettingChange);
        elements.retryDelay.addEventListener('change', handleSettingChange);

        // Path input change handler
        elements.mountLocation.addEventListener('change', handleSettingChange);

        // Button handlers
        elements.browseMountLocation.addEventListener('click', browseMountLocation);
        elements.manageConnections.addEventListener('click', manageConnections);
        elements.clearAllData.addEventListener('click', clearAllData);
        elements.resetDefaults.addEventListener('click', resetDefaults);
        elements.cancelBtn.addEventListener('click', cancelChanges);
        elements.saveBtn.addEventListener('click', saveChanges);

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                cancelChanges();
            } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                saveChanges();
            }
        });
    }

    function handleSettingChange(event) {
        const element = event.target;
        const value = element.type === 'checkbox' ? element.checked : element.value;

        // Update current settings based on the changed element
        switch (element.id) {
            case 'startAtLogin':
                currentSettings.startAtLogin = value;
                break;
            case 'rememberCredentials':
                currentSettings.rememberCredentials = value;
                break;
            case 'autoMountEnabled':
                currentSettings.autoMountEnabled = value;
                break;
            case 'networkWatcherEnabled':
                currentSettings.networkWatcher.enabled = value;
                break;
            case 'checkInterval':
                currentSettings.networkWatcher.checkInterval = parseInt(value);
                break;
            case 'retryAttempts':
                currentSettings.networkWatcher.retryAttempts = parseInt(value);
                break;
            case 'retryDelay':
                currentSettings.networkWatcher.retryDelay = parseInt(value);
                break;
            case 'mountLocation':
                currentSettings.mountLocation = value;
                break;
        }

        // Update save button state
        updateSaveButtonState();
    }

    function updateNetworkSettingsVisibility() {
        const networkSettings = document.querySelectorAll('.network-settings');
        const enabled = elements.networkWatcherEnabled.checked;

        networkSettings.forEach(setting => {
            setting.classList.toggle('enabled', enabled);
        });

        // Enable/disable network setting inputs
        elements.checkInterval.disabled = !enabled;
        elements.retryAttempts.disabled = !enabled;
        elements.retryDelay.disabled = !enabled;
    }

    function updateSaveButtonState() {
        const hasChanges = JSON.stringify(originalSettings) !== JSON.stringify(currentSettings);
        elements.saveBtn.disabled = !hasChanges;
    }

    async function browseMountLocation() {
        try {
            const result = await window.api.selectDirectory();
            if (result && !result.canceled && result.filePaths.length > 0) {
                const selectedPath = result.filePaths[0];
                elements.mountLocation.value = selectedPath;
                currentSettings.mountLocation = selectedPath;
                updateSaveButtonState();
            }
        } catch (error) {
            console.error('Failed to browse mount location:', error);
            showStatus('Failed to select directory', 'error');
        }
    }

    async function manageConnections() {
        try {
            // Open the connections management window
            await window.api.openConnectionManager();
        } catch (error) {
            console.error('Failed to open connection manager:', error);
            showStatus('Failed to open connection manager', 'error');
        }
    }

    async function clearAllData() {
        const confirmed = confirm(
            'Are you sure you want to clear all saved connections and credentials?\n\n' +
            'This action cannot be undone.'
        );

        if (confirmed) {
            try {
                await window.api.clearAllData();
                showStatus('All data cleared successfully', 'success');
                
                // Reload settings to reflect changes
                await loadSettings();
            } catch (error) {
                console.error('Failed to clear all data:', error);
                showStatus('Failed to clear data', 'error');
            }
        }
    }

    async function resetDefaults() {
        const confirmed = confirm(
            'Are you sure you want to reset all settings to their default values?\n\n' +
            'This will not affect your saved connections.'
        );

        if (confirmed) {
            try {
                // Set default values
                const defaultSettings = {
                    autoMountEnabled: true,
                    rememberCredentials: true,
                    startAtLogin: false,
                    networkWatcher: {
                        enabled: true,
                        checkInterval: 15,
                        retryAttempts: 5,
                        retryDelay: 2
                    },
                    mountLocation: `${await window.api.getHomeDirectory()}/mounts`
                };

                currentSettings = { ...defaultSettings };

                // Update form elements
                elements.startAtLogin.checked = defaultSettings.startAtLogin;
                elements.rememberCredentials.checked = defaultSettings.rememberCredentials;
                elements.autoMountEnabled.checked = defaultSettings.autoMountEnabled;
                elements.networkWatcherEnabled.checked = defaultSettings.networkWatcher.enabled;
                elements.checkInterval.value = defaultSettings.networkWatcher.checkInterval;
                elements.retryAttempts.value = defaultSettings.networkWatcher.retryAttempts;
                elements.retryDelay.value = defaultSettings.networkWatcher.retryDelay;
                elements.mountLocation.value = defaultSettings.mountLocation;

                updateNetworkSettingsVisibility();
                updateSaveButtonState();

                showStatus('Settings reset to defaults', 'info');
            } catch (error) {
                console.error('Failed to reset defaults:', error);
                showStatus('Failed to reset settings', 'error');
            }
        }
    }

    async function saveChanges() {
        try {
            elements.saveBtn.disabled = true;
            elements.saveBtn.textContent = 'Saving...';

            // Save all settings
            await window.api.saveAllSettings(currentSettings);

            // Update original settings
            originalSettings = { ...currentSettings };
            
            showStatus('Settings saved successfully', 'success');
            
            // Close window after successful save
            setTimeout(() => {
                window.close();
            }, 1500);

        } catch (error) {
            console.error('Failed to save settings:', error);
            showStatus('Failed to save settings', 'error');
        } finally {
            elements.saveBtn.disabled = false;
            elements.saveBtn.textContent = 'Save Changes';
        }
    }

    function cancelChanges() {
        const hasChanges = JSON.stringify(originalSettings) !== JSON.stringify(currentSettings);
        
        if (hasChanges) {
            const confirmed = confirm('You have unsaved changes. Are you sure you want to close without saving?');
            if (!confirmed) {
                return;
            }
        }
        
        window.close();
    }

    function showStatus(message, type) {
        elements.statusMessage.textContent = message;
        elements.statusMessage.className = `status-message ${type}`;
        elements.statusMessage.style.display = 'block';

        // Auto-hide after 5 seconds
        setTimeout(() => {
            elements.statusMessage.style.display = 'none';
        }, 5000);
    }

    // Initial save button state
    updateSaveButtonState();
});
