# Automation Bot Chrome Extension

A Chrome extension for automating credit loading on gaming panels, designed to evade Cloudflare detection by running in a real browser context.

## Features

- **Real Browser Context**: Runs in actual Chrome (not Playwright), avoiding bot detection
- **Hybrid Communication**: WebSocket + polling fallback for reliable backend connection
- **Human-like Behavior**: Randomized delays, character-by-character typing, mouse movements
- **Session Persistence**: Login once, reuse cookies indefinitely
- **Manual Controls**: Popup UI for status monitoring and emergency kill switch
- **Secure Storage**: Credentials stored encrypted in browser storage

## Architecture

### Components

1. **Service Worker** (`background/service-worker.js`)
   - Maintains connection to Backend API (WebSocket or polling)
   - Receives credit loading jobs from queue
   - Orchestrates job execution
   - Reports status back to backend

2. **Job Processor** (`background/job-processor.js`)
   - Opens/focuses panel tab
   - Checks login status
   - Executes login flow if needed
   - Executes credit loading automation

3. **Content Scripts** (`content/`)
   - `panel-automation.js`: DOM manipulation for panel
   - `humanize.js`: Human-like interaction utilities

4. **Popup UI** (`popup/`)
   - Status display (IDLE, CONNECTED, PROCESSING, ERROR)
   - Current job information
   - Manual controls (reconnect, kill switch)
   - Quick stats

5. **Options Page** (`options/`)
   - Backend API configuration
   - Panel credentials
   - Automation behavior settings
   - Connection testing

## Installation

### Development Mode

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `apps/automation-extension` directory
5. Extension should appear in your extensions list

### Configuration

**IMPORTANT:** The API Key MUST match the `BOT_API_KEY` in your backend's `.env` file, otherwise the extension will fail to connect.

1. **Get the API Key from backend:**
   - Open `apps/backend-api/.env`
   - Copy the value of `BOT_API_KEY` (e.g., `Narciso`)

2. **Configure the extension:**
   - Click the extension icon in Chrome toolbar
   - Click "⚙️ Settings" in popup
   - Fill in ALL fields:
     - **Backend API URL**: Your Backend API server (e.g., `http://localhost:3000`)
     - **API Key**: PASTE the exact `BOT_API_KEY` from backend .env (MUST MATCH)
     - **Panel URL**: Gaming panel URL
     - **Panel Credentials**: Username and password for panel
     - **Delays**: Min/Max delays for human-like behavior (default: 2000-7000ms)

3. **Save and verify:**
   - Click "💾 Save Settings"
   - Click "🔌 Test Connection" to verify backend connectivity
   - Extension status should change from "DISCONNECTED" to "CONNECTED"

**Troubleshooting:** If you see "Bot authentication failed" in backend logs, the API keys don't match. Double-check both values are identical.

## Usage

### Automatic Mode (Recommended)

1. Configure extension (see above)
2. Extension automatically connects to backend
3. Jobs are received from backend queue
4. Automation runs automatically
5. Operators only intervene if something fails

### Manual Mode

1. Open extension popup
2. Click "Open Panel" to open gaming panel
3. Use backend API or Operator Panel to manually trigger jobs

### Kill Switch

If you need to stop automation immediately:

1. Open extension popup
2. Click "🛑 Kill Switch"
3. All automation stops, current job is cancelled

## File Structure

```
apps/automation-extension/
├── manifest.json              # Extension manifest (Manifest V3)
├── background/
│   ├── service-worker.js      # Main orchestrator
│   ├── api-client.js          # Backend API communication
│   └── job-processor.js       # Job execution logic
├── content/
│   ├── panel-automation.js    # DOM manipulation for panel
│   └── humanize.js            # Human-like behavior utilities
├── popup/
│   ├── popup.html             # Popup UI
│   ├── popup.css              # Popup styles
│   └── popup.js               # Popup logic
├── options/
│   ├── options.html           # Settings page
│   ├── options.css            # Settings styles
│   └── options.js             # Settings logic
├── utils/
│   ├── storage.js             # Storage utilities
│   └── logger.js              # Logging utilities
└── icons/
    ├── icon16.png             # Extension icon 16x16
    ├── icon48.png             # Extension icon 48x48
    └── icon128.png            # Extension icon 128x128
```

## Customization for Your Panel

### Update Selectors

Edit `content/panel-automation.js` and update the `SELECTORS` object:

```javascript
const SELECTORS = {
  // Login page
  LOGIN_USERNAME_INPUT: 'input[name="your_username_field"]',
  LOGIN_PASSWORD_INPUT: 'input[name="your_password_field"]',
  LOGIN_SUBMIT_BUTTON: 'button.your-login-button',

  // Dashboard
  USER_MENU: '.your-user-menu',

  // Credit loading
  CREDITS_MENU_LINK: 'a[href="/your-credits-page"]',
  TARGET_USERNAME_INPUT: 'input#your-target-field',
  AMOUNT_INPUT: 'input#your-amount-field',
  SUBMIT_BUTTON: 'button.your-submit-button',

  // Success/Error
  SUCCESS_MESSAGE: '.your-success-class',
  ERROR_MESSAGE: '.your-error-class'
};
```

### Adjust Automation Flow

If your panel has a different flow (e.g., multi-step credit loading, confirmation dialogs), modify the `loadCredits()` function in `content/panel-automation.js`.

## Security Considerations

- **Credentials Storage**: Stored in `chrome.storage.local` (encrypted by Chrome)
- **API Key**: Never exposed to users, only sent to configured backend
- **HTTPS**: Always use HTTPS for backend API in production
- **Permissions**: Extension only requests necessary permissions

## Debugging

### Enable Debug Mode

1. Go to Settings (Options page)
2. Check "Debug Mode (verbose logging)"
3. Save settings

### View Console Logs

1. Right-click extension icon → "Inspect popup" (for popup logs)
2. Go to `chrome://extensions/` → Click "service worker" (for background logs)
3. Open panel tab → Right-click → "Inspect" → Console (for content script logs)

### Common Issues

**"Cannot connect to backend"**
- Check backend URL is correct
- Ensure backend API is running
- Verify API key is correct
- Check CORS settings on backend

**"Login failed"**
- Verify panel credentials are correct
- Check selectors match your panel's HTML
- Ensure panel doesn't have CAPTCHA or 2FA

**"Credit load failed"**
- Check selectors for credit loading page
- Verify target username format is correct
- Check panel logs for errors

## Backend Integration

### WebSocket Events

Extension listens for:

```javascript
{
  type: 'NEW_JOB',
  job: {
    id: 'uuid',
    targetUsername: 'user123',
    amount: 100
  }
}

{
  type: 'KILL_SWITCH'
}
```

### HTTP Endpoints

Extension calls:

- `GET /bot/jobs/next` - Poll for next job (polling mode)
- `POST /bot/jobs/:id/status` - Report job status
- `POST /bot/screenshots` - Upload error screenshots
- `POST /bot/logs` - Send log entries
- `POST /bot/heartbeat` - Report extension alive
- `GET /bot/health` - Health check

## Production Deployment

1. **Dedicated Automation Browser**
   - Install Chrome on server/VPS
   - Install extension in developer mode
   - Configure with production credentials
   - Keep browser always running (use tmux/screen)

2. **Security Hardening**
   - Use HTTPS for backend API
   - Rotate API keys regularly
   - Monitor logs for suspicious activity
   - Implement rate limiting on backend

3. **Monitoring**
   - Backend should monitor heartbeats
   - Alert if extension goes offline
   - Track job success/failure rates
   - Log all automation actions

## License

Internal use only - proprietary software.
