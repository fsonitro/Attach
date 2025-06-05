// This file contains the JavaScript logic for the mount popup, handling user input and communicating with the main process.

document.addEventListener('DOMContentLoaded', () => {
    const mountForm = document.getElementById('mount-form');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const smbPathInput = document.getElementById('smb-path');
    const mountButton = document.getElementById('mount-button');
    const messageBox = document.getElementById('message-box');

    mountButton.addEventListener('click', async (event) => {
        event.preventDefault();
        
        const username = usernameInput.value;
        const password = passwordInput.value;
        const smbPath = smbPathInput.value;

        if (!username || !password || !smbPath) {
            messageBox.textContent = 'Please fill in all fields.';
            return;
        }

        // Send the mount request to the main process
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('mount-smb', { username, password, smbPath });

        // Listen for the response from the main process
        ipcRenderer.on('mount-response', (event, response) => {
            messageBox.textContent = response.message;
            if (response.success) {
                // Clear the form on success
                mountForm.reset();
            }
        });
    });
});