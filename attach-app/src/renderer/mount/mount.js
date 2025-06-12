// This file contains the JavaScript logic for the mount popup, handling user input and communicating with the main process.

// Defer execution until DOM and styles are fully loaded
document.addEventListener('DOMContentLoaded', async () => {
    // Wait for CSS to be fully applied to prevent layout shifts
    await new Promise(resolve => {
        if (document.readyState === 'complete') {
            resolve();
        } else {
            window.addEventListener('load', resolve);
        }
    });

    const mountForm = document.getElementById('mountForm');
    const savedConnectionsSelect = document.getElementById('savedConnections');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const sharePathInput = document.getElementById('sharePath');
    const labelInput = document.getElementById('label');
    const saveCredentialsCheckbox = document.getElementById('saveCredentials');
    const autoMountCheckbox = document.getElementById('autoMount');
    const mountButton = document.getElementById('mountButton');
    const cancelButton = document.getElementById('cancelButton');
    const statusMessage = document.getElementById('status');
    const btnText = mountButton.querySelector('.btn-text');
    const loadingSpinner = mountButton.querySelector('.loading-spinner');

    let savedConnections = [];

    // Load saved connections on startup
    await loadSavedConnections();

    // Load settings
    await loadSettings();

    // Saved connections dropdown change handler
    savedConnectionsSelect.addEventListener('change', async (event) => {
        const connectionId = event.target.value;
        if (!connectionId) {
            clearForm();
            return;
        }

        try {
            const connection = savedConnections.find(conn => conn.id === connectionId);
            if (connection) {
                sharePathInput.value = connection.sharePath;
                usernameInput.value = connection.username;
                labelInput.value = connection.label;
                autoMountCheckbox.checked = connection.autoMount;
                saveCredentialsCheckbox.checked = true; // Since it's already saved
                
                // Load password
                const credentials = await window.api.getConnectionCredentials(connectionId);
                if (credentials) {
                    passwordInput.value = credentials.password;
                } else {
                    passwordInput.value = '';
                    showMessage('Password not found for this connection', 'warning');
                }
            }
        } catch (error) {
            showMessage('Failed to load connection details', 'error');
        }
    });

    // Form submission handler
    mountForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        const sharePath = sharePathInput.value.trim();
        const label = labelInput.value.trim();
        const saveCredentials = saveCredentialsCheckbox.checked;
        const autoMount = autoMountCheckbox.checked;

        if (!username || !password || !sharePath) {
            showMessage('Please fill in all required fields.', 'error');
            return;
        }

        try {
            // Show loading state
            showLoading(true);
            mountButton.disabled = true;
            
            // Send the mount request to the main process via IPC
            const result = await window.api.mountShare(sharePath, username, password, label, saveCredentials, autoMount);
            
            if (result.success) {
                showMessage(result.message, 'success');
                // Clear the form on success
                mountForm.reset();
                savedConnectionsSelect.value = '';
                
                // Reload saved connections in case a new one was added
                await loadSavedConnections();
                
                // Close the window after a short delay
                setTimeout(() => {
                    window.close();
                }, 2000);
            } else {
                showMessage(result.message, 'error');
            }
            
        } catch (error) {
            showMessage(`Failed to mount share: ${error.message}`, 'error');
        } finally {
            showLoading(false);
            mountButton.disabled = false;
        }
    });

    // Cancel button handler
    cancelButton.addEventListener('click', () => {
        window.close();
    });

    // Auto-populate credentials when share path changes and check for auto-mount
    sharePathInput.addEventListener('blur', async () => {
        const sharePath = sharePathInput.value.trim();
        if (sharePath && !savedConnectionsSelect.value) {
            try {
                // First check for auto-mountable connections
                const autoMountCheck = await window.api.checkForAutoMountableConnection(sharePath, usernameInput.value.trim() || undefined);
                
                if (autoMountCheck.hasAutoMountConnection) {
                    if (autoMountCheck.shouldAutoMount) {
                        // Show auto-mount prompt
                        const shouldAutoMount = confirm(
                            `Found saved connection "${autoMountCheck.connection.label}" with auto-mount enabled.\n\n` +
                            `Would you like to mount it automatically?`
                        );
                        
                        if (shouldAutoMount) {
                            try {
                                showLoading(true);
                                mountButton.disabled = true;
                                showMessage('Auto-mounting saved connection...', 'loading');
                                
                                const autoMountResult = await window.api.autoMountSavedConnection(sharePath, usernameInput.value.trim() || undefined);
                                
                                if (autoMountResult.success && autoMountResult.mounted) {
                                    showMessage(autoMountResult.message, 'success');
                                    // Close the window after successful auto-mount
                                    setTimeout(() => {
                                        window.close();
                                    }, 2000);
                                    return; // Exit early, no need to load credentials
                                } else {
                                    showMessage(autoMountResult.message, autoMountResult.success ? 'warning' : 'error');
                                    // Fall through to load credentials for manual mount
                                }
                            } catch (autoMountError) {
                                showMessage(`Auto-mount failed: ${autoMountError.message}`, 'error');
                                // Fall through to load credentials for manual mount
                            } finally {
                                showLoading(false);
                                mountButton.disabled = false;
                            }
                        }
                    } else if (autoMountCheck.connection) {
                        // Connection exists but auto-mount not applicable, show info and pre-fill
                        showMessage(`Found saved connection "${autoMountCheck.connection.label}" (${autoMountCheck.reason})`, 'info');
                        
                        // Pre-fill the form with saved connection data
                        usernameInput.value = autoMountCheck.connection.username;
                        labelInput.value = autoMountCheck.connection.label;
                        autoMountCheckbox.checked = autoMountCheck.connection.autoMount;
                        saveCredentialsCheckbox.checked = true;
                        
                        // Try to load the password
                        try {
                            const credentials = await window.api.getConnectionCredentials(autoMountCheck.connection.id);
                            if (credentials) {
                                passwordInput.value = credentials.password;
                            }
                        } catch (credError) {
                            // Password loading failed, user will need to enter it
                        }
                        
                        // Auto-hide info message
                        setTimeout(() => {
                            if (statusMessage.classList.contains('info')) {
                                statusMessage.style.display = 'none';
                            }
                        }, 4000);
                        
                        return; // Exit early, we've loaded the connection data
                    }
                }
                
                // Fallback: Try to load credentials using the legacy method
                const credentials = await window.api.getStoredCredentials(sharePath);
                if (credentials) {
                    usernameInput.value = credentials.username;
                    passwordInput.value = credentials.password;
                    saveCredentialsCheckbox.checked = true;
                    showMessage('Found saved credentials for this share', 'info');
                    
                    // Auto-hide info message
                    setTimeout(() => {
                        if (statusMessage.classList.contains('info')) {
                            statusMessage.style.display = 'none';
                        }
                    }, 3000);
                }
            } catch (error) {
                // Silently ignore credential loading errors
                if (process.env.NODE_ENV === 'development') {
                    console.error('Error checking for auto-mount or credentials:', error);
                }
            }
        }
    });

    // Load saved connections into dropdown
    async function loadSavedConnections() {
        try {
            savedConnections = await window.api.getRecentConnections(10);
            
            // Clear existing options except the first one
            savedConnectionsSelect.innerHTML = '<option value="">Select a saved connection...</option>';
            
            // Add saved connections
            savedConnections.forEach(connection => {
                const option = document.createElement('option');
                option.value = connection.id;
                option.textContent = `${connection.label} (${connection.sharePath})`;
                savedConnectionsSelect.appendChild(option);
            });
            
            // Show/hide the dropdown based on whether we have connections
            const savedConnectionsGroup = savedConnectionsSelect.closest('.form-group');
            savedConnectionsGroup.style.display = savedConnections.length > 0 ? 'flex' : 'none';
            
        } catch (error) {
            // Silently fail to load saved connections - app will work without them
        }
    }

    // Load settings
    async function loadSettings() {
        try {
            const settings = await window.api.getAutoMountSettings();
            // Settings loaded successfully (no action needed for UI)
        } catch (error) {
            // Silently fail to load settings - use defaults
        }
    }

    // Clear form fields
    function clearForm() {
        sharePathInput.value = '';
        usernameInput.value = '';
        passwordInput.value = '';
        labelInput.value = '';
        saveCredentialsCheckbox.checked = false;
        autoMountCheckbox.checked = false;
    }

    // Helper function to show messages
    function showMessage(message, type) {
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`;
        statusMessage.style.display = 'block';
        
        // Auto-hide success messages
        if (type === 'success') {
            setTimeout(() => {
                statusMessage.style.display = 'none';
            }, 3000);
        }
    }

    // Helper function to show/hide loading state
    function showLoading(show) {
        if (show) {
            btnText.style.display = 'none';
            loadingSpinner.style.display = 'block';
            showMessage('Mounting share...', 'loading');
        } else {
            btnText.style.display = 'block';
            loadingSpinner.style.display = 'none';
        }
    }

    // Focus on sharePath input when the window opens
    sharePathInput.focus();
    
    // Add input validation
    sharePathInput.addEventListener('input', (e) => {
        const value = e.target.value;
        // Allow share paths with special characters including $ for administrative shares
        if (value && !value.match(/^(smb:\/\/|\/\/)?[\w.\-\$]+(\/[\w.\-\$]+)*\/?$/)) {
            sharePathInput.setCustomValidity('Please enter a valid SMB path (e.g., smb://server/share)');
        } else {
            sharePathInput.setCustomValidity('');
        }
    });

    // Add username validation to support email addresses
    usernameInput.addEventListener('input', (e) => {
        const value = e.target.value;
        // Allow usernames and email addresses - alphanumeric characters, dots, underscores, @ symbols, and hyphens
        if (value && !value.match(/^[a-zA-Z0-9._@-]+$/)) {
            usernameInput.setCustomValidity('Username can contain letters, numbers, dots, underscores, @ symbols, and hyphens');
        } else {
            usernameInput.setCustomValidity('');
        }
    });
});