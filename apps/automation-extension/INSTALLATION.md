# Installation Guide

## Quick Start

### 1. Install the Extension

1. Open Google Chrome
2. Navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right corner)
4. Click **Load unpacked**
5. Select the `apps/automation-extension` folder
6. Extension should appear in your extensions list with a puzzle piece icon

### 2. Pin the Extension (Optional but Recommended)

1. Click the puzzle piece icon in Chrome toolbar
2. Find "Game Panel Automation Bot"
3. Click the pin icon to keep it visible in toolbar

### 3. Configure the Extension

1. Click the extension icon in Chrome toolbar (or press `Alt+Shift+B`)
2. In the popup, click **⚙️ Settings**
3. Fill in the configuration:

   **Backend API Configuration:**
   - Backend API URL: `http://localhost:3000` (or your production URL)
   - API Key: Your bot API key from the backend

   **Gaming Panel Credentials:**
   - Panel URL: `https://your-gaming-panel.com`
   - Panel Username: Your panel admin username
   - Panel Password: Your panel admin password

   **Automation Behavior:**
   - Min Delay: `2000` ms (recommended)
   - Max Delay: `7000` ms (recommended)
   - Debug Mode: Check this if you want verbose logging

4. Click **💾 Save Settings**
5. Click **🔌 Test Connection** to verify backend is reachable

### 4. Verify Everything Works

1. Go back to the popup (click extension icon)
2. Check that:
   - Status badge shows **CONNECTED** (green checkmark)
   - Connection type shows **WEBSOCKET** or **POLLING**
   - Backend URL is displayed correctly

## Production Deployment

### On a VPS/Server

1. **Install Chrome on server:**
   ```bash
   # Ubuntu/Debian
   wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
   sudo dpkg -i google-chrome-stable_current_amd64.deb
   sudo apt-get install -f
   ```

2. **Set up X server (for headful Chrome):**
   ```bash
   sudo apt-get install xvfb
   ```

3. **Upload extension to server:**
   ```bash
   scp -r apps/automation-extension/ user@server:/opt/automation-extension
   ```

4. **Run Chrome with extension in headful mode:**
   ```bash
   # Start Xvfb
   Xvfb :99 -screen 0 1920x1080x24 &
   export DISPLAY=:99

   # Launch Chrome with extension
   google-chrome \
     --load-extension=/opt/automation-extension \
     --no-first-run \
     --no-default-browser-check \
     --disable-gpu \
     --window-size=1920,1080 \
     &
   ```

5. **Keep Chrome running (use systemd or PM2):**

   Create `/etc/systemd/system/automation-chrome.service`:
   ```ini
   [Unit]
   Description=Automation Chrome Browser
   After=network.target

   [Service]
   Type=simple
   User=automation
   Environment=DISPLAY=:99
   ExecStartPre=/usr/bin/Xvfb :99 -screen 0 1920x1080x24
   ExecStart=/usr/bin/google-chrome \
     --load-extension=/opt/automation-extension \
     --no-first-run \
     --no-default-browser-check \
     --window-size=1920,1080
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```

   Then:
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable automation-chrome
   sudo systemctl start automation-chrome
   ```

### Security Considerations for Production

1. **Use HTTPS for backend API** (never HTTP in production)
2. **Rotate API keys regularly**
3. **Use strong panel passwords**
4. **Restrict server access** (firewall, SSH keys only)
5. **Monitor logs** for suspicious activity
6. **Enable VNC/remote desktop** to view the Chrome window remotely

## Troubleshooting

### Extension Not Loading

- **Error**: "Manifest file is missing or unreadable"
  - **Fix**: Make sure you selected the correct folder (`apps/automation-extension`)

- **Error**: "Service worker registration failed"
  - **Fix**: Check Chrome version (needs Chrome 88+), restart Chrome

### Cannot Connect to Backend

- **Error**: "Connection failed: ERR_CONNECTION_REFUSED"
  - **Fix**: Ensure backend is running, check URL is correct
  - **Fix**: Check firewall/network settings

- **Error**: "Connection failed: 401 Unauthorized"
  - **Fix**: Verify API key is correct in Settings

### Login Fails

- **Error**: "Login failed - no user menu found"
  - **Fix**: Panel credentials might be wrong
  - **Fix**: Selectors might not match your panel (see customization guide in README)

### Jobs Not Processing

- **Issue**: Extension shows CONNECTED but no jobs
  - **Fix**: Check backend queue has jobs waiting
  - **Fix**: Check WebSocket connection (should show "WEBSOCKET" not "POLLING")
  - **Fix**: Check backend logs for errors

- **Issue**: Jobs fail immediately
  - **Fix**: Check panel selectors are correct
  - **Fix**: Enable debug mode and check console logs
  - **Fix**: Manually test the panel to see if workflow changed

## Updating the Extension

1. Make changes to extension files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Extension reloads with new changes

## Uninstalling

1. Go to `chrome://extensions/`
2. Find "Game Panel Automation Bot"
3. Click **Remove**
4. Confirm removal

Note: This will not delete the extension files, only removes it from Chrome.
