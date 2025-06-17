/**
 * Test file for dropdown positioning in the main window
 * This file demonstrates the enhanced dropdown behavior with edge-case handling
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');

async function testDropdownPositioning() {
    console.log('🧪 Testing dropdown positioning behavior...');
    
    // Create a test window similar to the main window
    const testWindow = new BrowserWindow({
        width: 480,
        height: 540,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        show: true,
        title: 'Dropdown Test Window'
    });
    
    // Load test HTML content
    const testHTML = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Dropdown Position Test</title>
        <style>
            body { 
                font-family: -apple-system, BlinkMacSystemFont, sans-serif; 
                background: #2c2c2e;
                color: white;
                padding: 20px;
            }
            .test-scenarios {
                display: flex;
                flex-direction: column;
                gap: 20px;
            }
            .scenario {
                padding: 15px;
                background: rgba(58, 58, 60, 0.8);
                border-radius: 8px;
                border: 1px solid rgba(99, 99, 102, 0.3);
            }
            .test-button {
                padding: 8px 16px;
                background: #007aff;
                color: white;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                margin: 5px;
            }
            .test-button:hover {
                background: #0056cc;
            }
            .dropdown-test {
                position: fixed;
                background: rgba(28, 28, 30, 0.98);
                border: 1px solid rgba(99, 99, 102, 0.6);
                border-radius: 12px;
                padding: 10px;
                min-width: 200px;
                max-width: 300px;
                z-index: 999999;
                display: none;
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
            }
            .dropdown-test.show {
                display: block;
            }
        </style>
    </head>
    <body>
        <h1>Dropdown Positioning Test</h1>
        <div class="test-scenarios">
            <div class="scenario">
                <h3>✅ Enhanced Positioning Features:</h3>
                <ul>
                    <li>Fixed positioning prevents clipping inside window</li>
                    <li>Edge detection ensures dropdown stays visible</li>
                    <li>Dynamic width calculation respects available space</li>
                    <li>Smart vertical positioning (above/below button)</li>
                    <li>Minimum edge padding prevents touching window borders</li>
                    <li>Fallback handling for constrained spaces</li>
                    <li><strong>🆕 "Open All" button always visible at TOP of dropdown</strong></li>
                    <li><strong>🆕 Sticky positioning for easy access to bulk actions</strong></li>
                </ul>
            </div>
            
            <div class="scenario">
                <h3>🎯 Test Buttons (try different window positions):</h3>
                <button class="test-button" onclick="testPosition('top-left')" style="position: absolute; top: 50px; left: 20px;">Top Left</button>
                <button class="test-button" onclick="testPosition('top-right')" style="position: absolute; top: 50px; right: 20px;">Top Right</button>
                <button class="test-button" onclick="testPosition('bottom-left')" style="position: absolute; bottom: 50px; left: 20px;">Bottom Left</button>
                <button class="test-button" onclick="testPosition('bottom-right')" style="position: absolute; bottom: 50px; right: 20px;">Bottom Right</button>
                <button class="test-button" onclick="testPosition('center')" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);">Center</button>
            </div>
            
            <div class="scenario">
                <h3>📏 Window Size: <span id="windowSize">-</span></h3>
                <h3>🖱️ Last Test: <span id="lastTest">None</span></h3>
            </div>
        </div>
        
        <div class="dropdown-test" id="testDropdown">
            <div>🎉 Dropdown positioned successfully!</div>
            <div>Position: <span id="dropdownPosition">-</span></div>
            <div>Size: <span id="dropdownSize">-</span></div>
            <div><small>Click outside to close</small></div>
        </div>
        
        <script>
            function updateWindowSize() {
                document.getElementById('windowSize').textContent = 
                    window.innerWidth + 'x' + window.innerHeight;
            }
            
            function testPosition(scenario) {
                const dropdown = document.getElementById('testDropdown');
                const button = event.target;
                const buttonRect = button.getBoundingClientRect();
                
                // Use the same positioning logic as the main app
                positionDropdown(dropdown, button);
                
                document.getElementById('lastTest').textContent = scenario;
                document.getElementById('dropdownPosition').textContent = 
                    Math.round(dropdown.offsetLeft) + ', ' + Math.round(dropdown.offsetTop);
                document.getElementById('dropdownSize').textContent = 
                    dropdown.offsetWidth + 'x' + dropdown.offsetHeight;
                
                dropdown.classList.add('show');
                
                // Auto-hide after 3 seconds
                setTimeout(() => {
                    dropdown.classList.remove('show');
                }, 3000);
            }
            
            function positionDropdown(dropdown, button) {
                const buttonRect = button.getBoundingClientRect();
                const windowWidth = window.innerWidth;
                const windowHeight = window.innerHeight;
                
                const dropdownMaxWidth = 300;
                const dropdownMaxHeight = 350;
                const dropdownMinWidth = 200;
                const edgePadding = 12;
                const buttonSpacing = 6;
                
                const spaceBelow = windowHeight - buttonRect.bottom;
                const spaceAbove = buttonRect.top;
                
                let optimalWidth = Math.max(buttonRect.width, dropdownMinWidth);
                optimalWidth = Math.min(optimalWidth, dropdownMaxWidth);
                
                const maxWidthFromLeft = windowWidth - buttonRect.left - edgePadding;
                optimalWidth = Math.min(optimalWidth, maxWidthFromLeft);
                
                let dropdownLeft = buttonRect.left;
                if (dropdownLeft + optimalWidth > windowWidth - edgePadding) {
                    dropdownLeft = buttonRect.right - optimalWidth;
                }
                if (dropdownLeft < edgePadding) {
                    dropdownLeft = edgePadding;
                }
                
                let dropdownTop, maxHeight;
                if (spaceBelow >= 150) {
                    dropdownTop = buttonRect.bottom + buttonSpacing;
                    maxHeight = Math.min(dropdownMaxHeight, spaceBelow - buttonSpacing - edgePadding);
                } else if (spaceAbove >= 150) {
                    dropdownTop = buttonRect.top - buttonSpacing - 100; // Approximate dropdown height
                    maxHeight = Math.min(dropdownMaxHeight, spaceAbove - buttonSpacing - edgePadding);
                } else {
                    dropdownTop = buttonRect.bottom + buttonSpacing;
                    maxHeight = Math.max(100, spaceBelow - buttonSpacing - edgePadding);
                }
                
                dropdown.style.left = Math.round(dropdownLeft) + 'px';
                dropdown.style.top = Math.round(dropdownTop) + 'px';
                dropdown.style.width = Math.round(optimalWidth) + 'px';
                dropdown.style.maxHeight = Math.round(maxHeight) + 'px';
            }
            
            // Update window size display
            updateWindowSize();
            window.addEventListener('resize', updateWindowSize);
            
            // Hide dropdown on outside click
            document.addEventListener('click', (e) => {
                const dropdown = document.getElementById('testDropdown');
                if (!dropdown.contains(e.target) && !e.target.classList.contains('test-button')) {
                    dropdown.classList.remove('show');
                }
            });
            
            console.log('🎯 Dropdown positioning test loaded successfully!');
        </script>
    </body>
    </html>
    `;
    
    // Load the test content
    testWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(testHTML));
    
    console.log('✅ Test window created. Try the test buttons in different window positions!');
    console.log('📝 The enhanced positioning should prevent dropdown clipping in all scenarios.');
    
    return testWindow;
}

// Export for potential use in other tests
module.exports = { testDropdownPositioning };

// Run test if this file is executed directly
if (require.main === module) {
    app.whenReady().then(() => {
        testDropdownPositioning();
    });
}
