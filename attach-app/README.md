# 📄 Project Specification: macOS Electron App to Mount and Browse Network Shares

## 🧠 Goal

Create a **macOS Electron desktop application** that runs as a **menu bar (tray) app**. The app allows users to:

1. **Mount an SMB network share** by entering credentials.
2. **Browse mounted network shares** directly from the tray menu as expandable folder trees.

---

## ✅ Core Features

### 1. Tray Icon (Menu Bar App)
- Displays a tray icon (custom `.png` or `.icns`).
- Clicking the icon opens a tray menu with:
  - `Open Mounter` – opens a popup to enter credentials.
  - `Mounted Drives` – a dynamic submenu displaying mounted drives and their folder structure.
  - `Unmount All` – cleanly unmounts all mounted drives.
  - `Quit` – exits the app.

### 2. Mounting Network Shares
- Opens a small popup window for:
  - **Username**
  - **Password** (masked)
  - **SMB Share Path** (e.g. `smb://Workstation/nas`)
- On "Mount":
  - Mounts the drive to `/Volumes/<label>` using `mount_smbfs`.
  - Displays success/failure message in the UI.
  - Adds the mounted share to the `Mounted Drives` tray submenu.

### 3. Secure Credential Storage
- Uses `keytar` to store the password securely in the macOS Keychain.
- Remembers usernames and mount paths per session.

### 4. Browse Mounted Share Folders
- Under `Mounted Drives` in the tray menu:
  - Dynamically reads directory contents (first 1–2 levels deep).
  - Expands/collapses folders using nested submenus.
  - Option to open folders in Finder.

---

## 🧰 Technical Requirements

- **Framework**: Electron (JavaScript)
- **Storage**:
  - Secure credentials via `keytar`
  - Simple config (e.g. using `electron-store`)
- **Filesystem access**:
  - Read directory structure using `fs.readdir` and `fs.stat`
- **Command execution**:
  - Mount with `mount_smbfs`
  - Unmount with `umount /Volumes/<label>`
- **Security**:
  - Sanitize all inputs (avoid shell injection)
  - Passwords never logged or exposed
- **Architecture**:
  - Use Electron's `main`, `preload`, and `renderer` processes with IPC
- **UI**:
  - Minimal HTML/CSS popup for mounting
  - Tray menu with dynamic submenu for browsing folders

---

## 📦 Installation

1. Clone the repository.
2. Navigate to the project directory.
3. Run `npm install` to install dependencies.

## 🚀 Usage

1. Start the application with `npm start`.
2. Click the tray icon to access the menu and mount network shares.

## 🛠️ Development

- Use TypeScript for development.
- Follow the project structure outlined above for adding new features or modifying existing ones.

## 📄 License

This project is licensed under the MIT License.