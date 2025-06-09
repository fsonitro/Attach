# About Window Implementation

## Overview
Added a professional About window to the Attach app, similar to the Rectangle app design shown in the reference image.

## Features Implemented

### About Window (`src/renderer/about/`)
- **Dark macOS-styled window** with modern design
- **App icon display** with hover effects and entrance animation
- **Version information** dynamically loaded from package.json
- **System information** showing Electron, Node.js, and platform details
- **Copyright notice** with automatic year updating
- **Acknowledgements modal** listing key dependencies (Electron, keytar, TypeScript, macOS SMB)
- **Smooth animations** and transitions throughout
- **Responsive design** with proper keyboard shortcuts (Esc to close, Cmd+W)
- **External link handling** for acknowledgement URLs

### Integration Points
- **Tray Menu**: Added "About Attach" option in the tray context menu
- **Main Window**: Added "About" button in the main window interface
- **IPC Handlers**: Added proper IPC communication for opening/closing the About window
- **Window Management**: Integrated with existing window management system

### Technical Implementation
- **TypeScript support** with proper type definitions
- **Preload script integration** for secure IPC communication
- **Performance optimizations** including CSS containment and preloading
- **Error handling** with fallback values for system information
- **Memory management** with proper window cleanup

### Visual Design
- **Dark theme** matching macOS design patterns
- **Gradient backgrounds** and subtle shadows
- **SF Pro Display font** for native macOS feel
- **Proper spacing and typography** following Apple's design guidelines
- **Smooth hover effects** and button interactions
- **Modal overlay** with backdrop blur for acknowledgements

### Keyboard Shortcuts
- `Escape` - Close About window or acknowledgements modal
- `Cmd+W` - Close About window
- Mouse click outside modal - Close acknowledgements

### External Dependencies Acknowledged
- Electron - Cross-platform desktop app framework
- keytar - System keychain/keyring management
- TypeScript - Typed JavaScript superset
- macOS SMB - Native SMB mounting capabilities

## Usage
Users can access the About window through:
1. **Tray Menu**: Right-click tray icon → "About Attach"
2. **Main Window**: Click the "About" button
3. **Acknowledgements**: Click "Acknowledgements" button in About window to see dependencies

## Files Added/Modified

### New Files:
- `src/renderer/about/index.html` - About window HTML structure
- `src/renderer/about/about.css` - Dark theme styling and animations
- `src/renderer/about/about.js` - Window functionality and event handling

### Modified Files:
- `src/main/windows.ts` - Added About window creation and management functions
- `src/main/index.ts` - Added IPC handlers for About window and system info
- `src/main/tray.ts` - Added "About Attach" to tray menu
- `src/preload/index.ts` - Added API endpoints for About window and system info
- `src/renderer/main/index.html` - Added About button to main window

The About window provides a professional touch to the application and offers users transparency about the app's dependencies and system information.
