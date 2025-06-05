// This file contains the JavaScript logic for the mount popup, handling user input and communicating with the main process.

document.addEventListener('DOMContentLoaded', () => {
    const mountForm = document.getElementById('mountForm');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const sharePathInput = document.getElementById('sharePath');
    const labelInput = document.getElementById('label');
    const saveCredentialsCheckbox = document.getElementById('saveCredentials');
    const mountButton = document.getElementById('mountButton');
    const cancelButton = document.getElementById('cancelButton');
    const statusMessage = document.getElementById('status');
    const btnText = mountButton.querySelector('.btn-text');
    const loadingSpinner = mountButton.querySelector('.loading-spinner');

    // Form submission handler
    mountForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        
        const username = usernameInput.value.trim();
        const password = passwordInput.value;
        const sharePath = sharePathInput.value.trim();
        const label = labelInput.value.trim();
        const saveCredentials = saveCredentialsCheckbox.checked;

        if (!username || !password || !sharePath) {
            showMessage('Please fill in all required fields.', 'error');
            return;
        }

        try {
            // Show loading state
            showLoading(true);
            mountButton.disabled = true;
            
            // Send the mount request to the main process via IPC
            const result = await window.api.mountShare(sharePath, username, password, label, saveCredentials);
            
            if (result.success) {
                showMessage(result.message, 'success');
                // Clear the form on success
                mountForm.reset();
                
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

    // Auto-populate username field if available
    // You could extend this to load saved credentials
    
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