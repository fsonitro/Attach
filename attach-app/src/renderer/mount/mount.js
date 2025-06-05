// This file contains the JavaScript logic for the mount popup, handling user input and communicating with the main process.

document.addEventListener('DOMContentLoaded', async () => {
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
            console.error('Failed to load connection:', error);
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
            console.error('Mount error:', error);
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

    // Auto-populate credentials when share path changes
    sharePathInput.addEventListener('blur', async () => {
        const sharePath = sharePathInput.value.trim();
        if (sharePath && !savedConnectionsSelect.value) {
            try {
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
                console.error('Failed to load credentials:', error);
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
            console.error('Failed to load saved connections:', error);
        }
    }

    // Load settings
    async function loadSettings() {
        try {
            const settings = await window.api.getAutoMountSettings();
            // You could use these settings to set default checkbox states
            // For now, we'll just log them
            console.log('Auto-mount settings:', settings);
        } catch (error) {
            console.error('Failed to load settings:', error);
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
        if (value && !value.match(/^(smb:\/\/|\/\/)?[\w\.-]+(\/[\w\.-]+)*\/?$/)) {
            sharePathInput.setCustomValidity('Please enter a valid SMB path (e.g., smb://server/share)');
        } else {
            sharePathInput.setCustomValidity('');
        }
    });
});