# 📁 Attach - Network Share Mounter

A **macOS Electron desktop application** that runs as a **menu bar (tray) app** for mounting and browsing SMB network shares.

![Attach App](assets/icons/tray-icon-template.png)

## ✨ Features

### 🔧 **Core Functionality**
- **Tray Icon Integration**: Runs in macOS menu bar with customizable tray menu
- **SMB Share Mounting**: Mount network shares with username/password authentication
- **Dynamic Tray Menu**: Shows mounted drives with browsing options
- **Secure Credential Storage**: Optional password storage in macOS Keychain using `keytar`
- **Beautiful UI**: Modern gradient-based interface with smooth animations

### 🎯 **Key Features Implemented**

#### ✅ **Tray Icon & Menu**
- Custom tray icon that adapts to macOS light/dark themes
- Context menu with:
  - `Show App` - Opens the main application window
  - `Open Mounter` - Opens the mount credentials popup
  - `Mounted Drives` - Dynamic submenu showing all mounted shares
  - `Unmount All` - Cleanly unmounts all mounted drives
  - `Quit` - Exits the application

#### ✅ **Mount Network Shares**
- Popup window for entering:
  - Username (required)
  - Password (required, masked input)
  - SMB Share Path (e.g., `smb://server/share` or `//server/share`)
  - Mount Label (optional custom name)
  - Save Credentials checkbox (stores in Keychain)
- Real-time validation and error handling
- Success/failure feedback with detailed error messages

#### ✅ **Security & Error Handling**
- Input sanitization to prevent command injection
- Secure password storage using macOS Keychain
- Robust error handling with user-friendly messages
- Timeout handling for network operations
- Forced unmount capabilities for stuck mounts

#### ✅ **User Experience**
- 300x300px main window with gradient UI
- Responsive mount popup (400x300px)
- Loading states and progress indicators
- Auto-closing windows on successful operations
- Window hiding to tray instead of quitting

## 🚀 **Getting Started**

### Prerequisites
- macOS (required for SMB mounting and Keychain integration)
- Node.js and npm
- ImageMagick (for icon generation - optional)

### Installation
1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd attach-app
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the application:
   ```bash
   npm start
   ```

### Development
- **Build TypeScript**: `npm run build-ts`
- **Watch Mode**: `npm run watch`
- **Development Mode**: `npm run dev`

## 📖 **Usage**

### Basic Usage
1. **Launch the App**: Run `npm start` - you'll see the tray icon in your menu bar
2. **Mount a Share**: 
   - Click the tray icon → "Open Mounter"
   - Enter your credentials and SMB path
   - Optionally check "Save credentials" for future use
   - Click "Mount Share"
3. **Browse Mounted Shares**:
   - Click tray icon → "Mounted Drives"
   - Select a mounted share to browse or open in Finder
4. **Unmount**: Use individual unmount options or "Unmount All"

### SMB Path Examples
- `smb://192.168.1.100/shared`
- `//myserver.local/documents`
- `smb://workstation/nas`

### Error Handling
The app provides helpful error messages for common issues:
- **Authentication Failed**: Check username/password
- **Connection Timeout**: Check server address and network
- **Permission Denied**: Verify access rights
- **Server Unreachable**: Check network connectivity

## 🏗️ **Technical Architecture**

### Project Structure
```
src/
├── main/                   # Main Electron process
│   ├── index.ts           # App entry point and IPC handlers
│   ├── tray.ts            # Tray icon and menu management
│   ├── windows.ts         # Window creation and management
│   └── mount/             # SMB mounting logic
│       ├── smbService.ts  # SMB operations and keytar integration
│       └── fileSystem.ts  # File system utilities
├── preload/               # Preload scripts (security bridge)
│   └── index.ts          # IPC API exposure to renderer
├── renderer/              # Frontend UI
│   ├── main/             # Main window UI
│   ├── mount/            # Mount popup UI
│   └── shared/           # Shared styles
└── types/                # TypeScript type definitions
    └── index.ts
```

### Security Model
- **Process Isolation**: Uses Electron's security best practices
- **Context Isolation**: Renderer processes are isolated from Node.js
- **IPC Communication**: Secure message passing between processes
- **Input Sanitization**: All user inputs are sanitized before shell execution
- **Keychain Integration**: Passwords stored securely using macOS Keychain

### Technologies Used
- **Electron**: Cross-platform desktop app framework
- **TypeScript**: Type-safe JavaScript development
- **keytar**: Secure credential storage
- **HTML/CSS/JS**: Frontend UI with modern styling
- **macOS APIs**: Native SMB mounting via `mount_smbfs`

## 🔮 **Future Enhancements**

### Planned Features
- **Folder Browsing**: Nested tray submenus for directory exploration
- **Connection Profiles**: Save and manage multiple server connections
- **Auto-Mount**: Automatic mounting of saved connections on startup
- **Network Discovery**: Automatic discovery of SMB servers on the network
- **Connection Status**: Real-time monitoring of mount health
- **Drag & Drop**: Quick access to mounted share contents

### Technical Improvements
- **electron-store**: Persistent settings and preferences
- **Better Icons**: Higher resolution icons for different screen densities
- **Code Signing**: Proper app signing for distribution
- **Auto-Updates**: Automatic app update mechanism
- **Logging**: Comprehensive logging system for debugging

## 🐛 **Troubleshooting**

### Common Issues
1. **App doesn't appear**: Check Activity Monitor for running Electron processes
2. **Tray icon missing**: Ensure icon files exist in `assets/icons/`
3. **Mount failures**: Verify network connectivity and credentials
4. **Permission errors**: Run with appropriate user permissions

### Debug Mode
Run with debug output:
```bash
DEBUG=* npm start
```

### Logs
Check console output in the terminal for detailed error messages and mount status.

## 📄 **License**

This project is licensed under the MIT License.

---

**Attach** - Making network share access simple and secure on macOS! 🚀