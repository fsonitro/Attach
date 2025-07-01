// Settings window JavaScript
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for CSS to be fully applied to prevent layout shifts
    await new Promise(resolve => {
        if (document.readyState === 'complete') {
            resolve();
        } else {
            window.addEventListener('load', resolve);
        }
    });

    // Get all form elements
    const elements = {
        startAtLogin: document.getElementById('startAtLogin'),
        rememberCredentials: document.getElementById('rememberCredentials'),
        autoMountEnabled: document.getElementById('autoMountEnabled'),
        mountLocation: document.getElementById('mountLocation'),
        viewSavedConnections: document.getElementById('viewSavedConnections'),
        clearAllData: document.getElementById('clearAllData'),
        resetDefaults: document.getElementById('resetDefaults'),
        cancelBtn: document.getElementById('cancelBtn'),
        saveBtn: document.getElementById('saveBtn'),
        statusMessage: document.getElementById('statusMessage')
    };

    // Store original settings for comparison
    let originalSettings = {};
    let currentSettings = {};
    
    // Connection management state
    let selectedConnection = null;
    let isEditingConnection = false;

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
            elements.mountLocation.value = settings.mountLocation;

            // Load saved connections dropdown
            await loadSavedConnectionsDropdown();

        } catch (error) {
            showStatus('Failed to load settings', 'error');
        }
    }

    function setupEventListeners() {
        // Checkbox change handlers
        elements.startAtLogin.addEventListener('change', handleSettingChange);
        elements.rememberCredentials.addEventListener('change', handleSettingChange);
        elements.autoMountEnabled.addEventListener('change', handleSettingChange);

        // Path input change handler (note: mount location is now read-only)
        // elements.mountLocation.addEventListener('change', handleSettingChange);

        // Dropdown change handler
        elements.viewSavedConnections.addEventListener('change', handleConnectionSelection);

        // Button handlers
        elements.clearAllData.addEventListener('click', clearAllData);
        elements.resetDefaults.addEventListener('click', resetDefaults);
        elements.cancelBtn.addEventListener('click', cancelChanges);
        elements.saveBtn.addEventListener('click', saveChanges);

        // Connection management handlers
        document.getElementById('editConnectionBtn')?.addEventListener('click', enableConnectionEdit);
        document.getElementById('saveConnectionBtn')?.addEventListener('click', saveConnectionEdit);
        document.getElementById('cancelEditBtn')?.addEventListener('click', cancelConnectionEdit);
        document.getElementById('deleteConnectionBtn')?.addEventListener('click', deleteConnection);

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
            case 'mountLocation':
                currentSettings.mountLocation = value;
                break;
        }

        // Update save button state
        updateSaveButtonState();
    }

    function updateSaveButtonState() {
        const hasChanges = JSON.stringify(originalSettings) !== JSON.stringify(currentSettings);
        elements.saveBtn.disabled = !hasChanges;
    }

    async function loadSavedConnectionsDropdown() {
        try {
            // Load saved connections from main process
            const connections = await window.api.getSavedConnections();
            
            // Clear existing options
            elements.viewSavedConnections.innerHTML = '';
            
            if (connections && connections.length > 0) {
                // Add default option
                const defaultOption = document.createElement('option');
                defaultOption.value = '';
                defaultOption.textContent = `Select from ${connections.length} saved connection${connections.length === 1 ? '' : 's'}...`;
                elements.viewSavedConnections.appendChild(defaultOption);
                
                // Add saved connections
                connections.forEach(connection => {
                    const option = document.createElement('option');
                    option.value = connection.id;
                    
                    // Truncate long text to prevent dropdown expansion
                    const maxLabelLength = 20;
                    const maxSharePathLength = 25;
                    const maxUsernameLength = 15;
                    
                    const truncatedLabel = connection.label.length > maxLabelLength 
                        ? connection.label.substring(0, maxLabelLength - 3) + '...' 
                        : connection.label;
                    
                    const truncatedSharePath = connection.sharePath.length > maxSharePathLength 
                        ? connection.sharePath.substring(0, maxSharePathLength - 3) + '...' 
                        : connection.sharePath;
                    
                    const truncatedUsername = connection.username.length > maxUsernameLength 
                        ? connection.username.substring(0, maxUsernameLength - 3) + '...' 
                        : connection.username;
                    
                    // Show connection details in a readable format with truncation
                    option.textContent = `${truncatedLabel} - ${truncatedSharePath} (${truncatedUsername})`;
                    option.title = `${connection.label} - ${connection.sharePath} (${connection.username})`; // Full text on hover
                    elements.viewSavedConnections.appendChild(option);
                });
                
                // Enable the dropdown
                elements.viewSavedConnections.disabled = false;
            } else {
                // No connections found
                const noConnectionsOption = document.createElement('option');
                noConnectionsOption.value = '';
                noConnectionsOption.textContent = 'No saved connections';
                elements.viewSavedConnections.appendChild(noConnectionsOption);
                
                // Keep dropdown disabled
                elements.viewSavedConnections.disabled = true;
            }
        } catch (error) {
            // Silently fail to load connections, show error state
            elements.viewSavedConnections.innerHTML = '<option value="">Failed to load connections</option>';
            elements.viewSavedConnections.disabled = true;
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
                    mountLocation: `${await window.api.getHomeDirectory()}/mounts`
                };

                currentSettings = { ...defaultSettings };

                // Update form elements
                elements.startAtLogin.checked = defaultSettings.startAtLogin;
                elements.rememberCredentials.checked = defaultSettings.rememberCredentials;
                elements.autoMountEnabled.checked = defaultSettings.autoMountEnabled;
                elements.mountLocation.value = defaultSettings.mountLocation;

                updateSaveButtonState();

                showStatus('Settings reset to defaults', 'info');
            } catch (error) {
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

    function handleConnectionSelection(event) {
        const connectionId = event.target.value;
        const managementPanel = document.getElementById('connectionManagementPanel');
        
        if (!connectionId) {
            // No connection selected, hide management panel
            managementPanel.style.display = 'none';
            selectedConnection = null;
            return;
        }

        // Find the selected connection
        loadConnectionDetails(connectionId);
    }

    async function loadConnectionDetails(connectionId) {
        try {
            // Get all connections and find the selected one
            const connections = await window.api.getSavedConnections();
            selectedConnection = connections.find(conn => conn.id === connectionId);
            
            if (!selectedConnection) {
                showStatus('Connection not found', 'error');
                return;
            }

            // Populate the management panel
            document.getElementById('editConnectionLabel').value = selectedConnection.label;
            document.getElementById('editConnectionSharePath').value = selectedConnection.sharePath;
            document.getElementById('editConnectionUsername').value = selectedConnection.username;
            document.getElementById('editConnectionAutoMount').checked = selectedConnection.autoMount;
            document.getElementById('editConnectionLastUsed').textContent = new Date(selectedConnection.lastUsed).toLocaleString();
            document.getElementById('editConnectionCreated').textContent = new Date(selectedConnection.createdAt).toLocaleString();

            // Check mount status and update UI accordingly
            try {
                const mountStatus = await window.api.getConnectionMountStatus(connectionId);
                updateMountStatusDisplay(mountStatus);
            } catch (error) {
                console.warn('Failed to get mount status:', error);
                // Hide mount status if we can't get it
                const statusElement = document.getElementById('connectionMountStatus');
                if (statusElement) {
                    statusElement.style.display = 'none';
                }
            }

            // Show the management panel
            document.getElementById('connectionManagementPanel').style.display = 'block';
            
            // Reset edit state
            setConnectionEditMode(false);
            
        } catch (error) {
            showStatus('Failed to load connection details', 'error');
        }
    }

    function enableConnectionEdit() {
        if (!selectedConnection) return;
        setConnectionEditMode(true);
    }

    function setConnectionEditMode(editing) {
        isEditingConnection = editing;
        
        // Toggle readonly state of inputs
        document.getElementById('editConnectionLabel').readOnly = !editing;
        document.getElementById('editConnectionSharePath').readOnly = !editing;
        document.getElementById('editConnectionUsername').readOnly = !editing;
        document.getElementById('editConnectionAutoMount').disabled = !editing;
        
        // Show/hide edit warning
        const warningNotice = document.getElementById('editWarningNotice');
        if (warningNotice) {
            warningNotice.style.display = editing ? 'block' : 'none';
        }
        
        // Toggle button visibility
        document.getElementById('editConnectionBtn').style.display = editing ? 'none' : 'inline-block';
        document.getElementById('saveConnectionBtn').style.display = editing ? 'inline-block' : 'none';
        document.getElementById('cancelEditBtn').style.display = editing ? 'inline-block' : 'none';
        document.getElementById('deleteConnectionBtn').style.display = editing ? 'none' : 'inline-block';
    }

    async function saveConnectionEdit() {
        if (!selectedConnection || !isEditingConnection) return;

        try {
            const updatedData = {
                label: document.getElementById('editConnectionLabel').value.trim(),
                sharePath: document.getElementById('editConnectionSharePath').value.trim(),
                username: document.getElementById('editConnectionUsername').value.trim(),
                autoMount: document.getElementById('editConnectionAutoMount').checked
            };

            // Validate required fields
            if (!updatedData.label || !updatedData.sharePath || !updatedData.username) {
                showStatus('All fields are required', 'error');
                return;
            }

            // Update the connection via API
            const result = await window.api.updateConnection(selectedConnection.id, updatedData);
            
            if (result.success) {
                let message = 'Connection updated successfully';
                
                // Check if remounting is needed and offer the option
                if (result.needsRemount) {
                    message += '. Remount recommended for changes to take effect.';
                    
                    // Show remount option
                    showRemountOption(selectedConnection.id, result.changes || []);
                }
                
                showStatus(message, 'success');
                
                // Reload the connections dropdown
                await loadSavedConnectionsDropdown();
                
                // Update selected connection and reload details
                selectedConnection = { ...selectedConnection, ...updatedData };
                await loadConnectionDetails(selectedConnection.id);
                
            } else {
                showStatus(result.message || 'Failed to update connection', 'error');
            }
            
        } catch (error) {
            showStatus('Failed to update connection', 'error');
        }
    }

    function cancelConnectionEdit() {
        if (!selectedConnection) return;
        
        // Restore original values
        document.getElementById('editConnectionLabel').value = selectedConnection.label;
        document.getElementById('editConnectionSharePath').value = selectedConnection.sharePath;
        document.getElementById('editConnectionUsername').value = selectedConnection.username;
        document.getElementById('editConnectionAutoMount').checked = selectedConnection.autoMount;
        
        // Exit edit mode
        setConnectionEditMode(false);
    }

    async function deleteConnection() {
        if (!selectedConnection) return;

        const confirmed = confirm(
            `Are you sure you want to delete the connection "${selectedConnection.label}"?\n\n` +
            'This will remove the connection and its saved credentials.\n' +
            'This action cannot be undone.'
        );

        if (!confirmed) return;

        try {
            const result = await window.api.removeSavedConnection(selectedConnection.id);
            
            if (result.success) {
                showStatus('Connection deleted successfully', 'success');
                
                // Hide management panel
                document.getElementById('connectionManagementPanel').style.display = 'none';
                
                // Reload connections dropdown
                await loadSavedConnectionsDropdown();
                
                // Reset selection
                elements.viewSavedConnections.value = '';
                selectedConnection = null;
                
            } else {
                showStatus(result.message || 'Failed to delete connection', 'error');
            }
            
        } catch (error) {
            showStatus('Failed to delete connection', 'error');
        }
    }

    // Initial save button state
    updateSaveButtonState();

    // Helper function to update mount status display
    function updateMountStatusDisplay(mountStatus) {
        const statusContainer = document.getElementById('connectionMountStatus');
        if (!statusContainer) return; // Element might not exist yet

        if (mountStatus.success && mountStatus.isMounted) {
            statusContainer.style.display = 'block';
            
            let statusText = '🟢 Currently mounted';
            let statusClass = 'mount-status-mounted';
            
            if (mountStatus.hasLabelMismatch) {
                statusText = '🟡 Mounted with outdated label';
                statusClass = 'mount-status-outdated';
            }
            
            statusContainer.className = `mount-status ${statusClass}`;
            statusContainer.innerHTML = `
                <div class="mount-status-text">${statusText}</div>
                <div class="mount-status-details">
                    <small>Mount Point: ${mountStatus.mountedShare?.mountPoint || 'Unknown'}</small>
                    ${mountStatus.hasLabelMismatch ? 
                        `<small>Current Label: "${mountStatus.currentLabel}" (will become "${selectedConnection?.label}")</small>` : 
                        ''
                    }
                </div>
                ${mountStatus.hasLabelMismatch ? 
                    '<button type="button" id="updateMountBtn" class="btn-secondary small">Update Mount</button>' : 
                    ''
                }
            `;
            
            // Add event listener for update mount button
            const updateBtn = document.getElementById('updateMountBtn');
            if (updateBtn) {
                updateBtn.addEventListener('click', () => remountConnection(selectedConnection.id, mountStatus.currentLabel));
            }
        } else {
            statusContainer.style.display = 'block';
            statusContainer.className = 'mount-status mount-status-unmounted';
            statusContainer.innerHTML = '<div class="mount-status-text">⚪ Not currently mounted</div>';
        }
    }

    // Helper function to show remount option after connection update
    function showRemountOption(connectionId, changes) {
        const statusMessage = document.getElementById('statusMessage');
        if (!statusMessage) return;

        // Create remount button container
        const remountContainer = document.createElement('div');
        remountContainer.className = 'remount-option';
        remountContainer.innerHTML = `
            <p>Changes made to: ${changes.join(', ')}</p>
            <button type="button" id="remountConnectionBtn" class="btn-primary small">
                Remount to Apply Changes
            </button>
            <button type="button" id="dismissRemountBtn" class="btn-secondary small">
                Dismiss
            </button>
        `;

        // Insert after status message
        statusMessage.parentNode.insertBefore(remountContainer, statusMessage.nextSibling);

        // Add event listeners
        document.getElementById('remountConnectionBtn').addEventListener('click', async () => {
            await remountConnection(connectionId);
            remountContainer.remove();
        });

        document.getElementById('dismissRemountBtn').addEventListener('click', () => {
            remountContainer.remove();
        });

        // Auto-dismiss after 15 seconds
        setTimeout(() => {
            if (remountContainer.parentNode) {
                remountContainer.remove();
            }
        }, 15000);
    }

    // Function to remount a connection
    async function remountConnection(connectionId, oldLabel) {
        try {
            showStatus('Remounting connection...', 'info');
            
            const result = await window.api.remountUpdatedConnection(connectionId, oldLabel);
            
            if (result.success) {
                showStatus('Connection remounted successfully with updated details', 'success');
                
                // Refresh mount status
                if (selectedConnection) {
                    const mountStatus = await window.api.getConnectionMountStatus(connectionId);
                    updateMountStatusDisplay(mountStatus);
                }
            } else {
                showStatus(result.message || 'Failed to remount connection', 'error');
            }
            
        } catch (error) {
            showStatus('Failed to remount connection', 'error');
            console.error('Remount error:', error);
        }
    }
});
