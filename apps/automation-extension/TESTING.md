# Testing Guide - Chrome Extension Integration

## Current Status

✅ **Extension Updated**:
- Panel selectors configured for TioRico panel workflow
- API client updated to match backend endpoints exactly
- Service worker uses correct authentication (`X-Bot-API-Key` header)
- Heartbeat every 60 seconds

✅ **Backend Integration**:
- Extension uses existing endpoints:
  - `GET /bot/jobs/pending` - Poll for jobs
  - `POST /bot/jobs/:id/started` - Report job started
  - `POST /bot/jobs/:id/result` - Report completion/failure
  - `POST /bot/jobs/:id/progress` - Progress updates
  - `POST /bot/heartbeat` - Health check
  - `POST /bot/screenshots` - Upload error screenshots
  - `POST /bot/logs` - Send logs
  - `GET /bot/kill-switch` - Check kill switch

⚠️ **Selector Verification Needed**:
The selectors are based on limited HTML visibility (Cloudflare challenges in provided files). You may need to adjust them after testing.

---

## Setup Instructions

### 1. Install the Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select `/apps/automation-extension` folder
5. Extension should load successfully

### 2. Configure the Extension

1. Click the extension icon in Chrome toolbar
2. Click **⚙️ Settings** in the popup
3. Fill in:
   - **Backend API URL**: `http://localhost:3000` (or your backend URL)
   - **API Key**: Your bot API key (from `.env` → `BOT_API_KEY`)
   - **Panel URL**: `https://admin.tioricojuegos.com`
   - **Panel Username**: Your admin username
   - **Panel Password**: Your admin password
   - **Min Delay**: `2000` ms
   - **Max Delay**: `7000` ms
4. Click **💾 Save Settings**
5. Click **🔌 Test Connection**

Expected: Should show "Connection successful!"

### 3. Verify Extension Connection

1. Go back to popup (click extension icon)
2. Check status badge shows **CONNECTED** (green checkmark)
3. Check connection type shows **POLLING** (WebSocket not implemented yet)

---

## Testing the Full Flow

### Step 1: Create a Test Request

Use your backend to create a test credit load request:

```bash
# Via backend API (as ADMIN user)
curl -X POST http://localhost:3000/requests \
  -H "Authorization: Bearer <admin-jwt-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "targetUsername": "testuser123",
    "amount": 100,
    "proofUrl": "https://example.com/proof.jpg"
  }'
```

Or use your Chat App to create a real request.

### Step 2: Approve the Request

The request needs to be approved (either by AI validation or manually):

```bash
# Manually approve request (as SENIOR_OPERATOR or ADMIN)
curl -X POST http://localhost:3000/requests/<request-id>/approve \
  -H "Authorization: Bearer <operator-jwt-token>"
```

This will create a job in the queue.

### Step 3: Watch the Extension

1. Keep the extension popup open to watch status
2. The extension polls every 10 seconds for jobs
3. When it finds the job:
   - Status changes to **PROCESSING**
   - Current job info appears in popup
4. Watch the panel tab open/focus automatically
5. Observe the automation execute:
   - Search for username
   - Click fa-plus button
   - Fill modal with amount
   - Click "Aceptar"

### Step 4: Verify Result

Check the job status in your backend:

```bash
# Get job details
curl http://localhost:3000/jobs/<job-id> \
  -H "Authorization: Bearer <operator-jwt-token>"
```

Expected: Status should be `COMPLETED` or `FAILED` with appropriate message.

---

## Debugging

### Enable Debug Mode

1. Go to extension Settings
2. Check **Debug Mode (verbose logging)**
3. Save settings

### View Logs

**Service Worker Console:**
1. Go to `chrome://extensions/`
2. Find "Game Panel Automation Bot"
3. Click **service worker** link
4. Opens DevTools with all service worker logs

**Content Script Console:**
1. Open the panel tab
2. Right-click → Inspect
3. Go to Console tab
4. All automation logs appear with `[Humanize]` and `[PanelAutomation]` prefixes

**Backend Logs:**
- Check your backend logs for incoming requests from extension
- Look for API key authentication logs

### Common Issues

**"Connection failed: 401 Unauthorized"**
- API key is wrong or missing
- Check `.env` file in backend: `BOT_API_KEY=your-key-here`
- Ensure key matches what you entered in extension settings

**"No jobs found" (polling returns 404)**
- This is normal when queue is empty
- Create a test request and approve it

**Extension shows IDLE instead of CONNECTED**
- Config not saved properly
- Go to Settings → Save again
- Check browser console for errors

**Panel automation fails**
- Selectors might not match your actual panel HTML
- See "Customizing Selectors" below

---

## Customizing Selectors

If automation fails because elements aren't found, you need to update selectors.

### How to Find Correct Selectors

1. **Open the panel** in Chrome
2. **Right-click** on the element you want to automate → **Inspect**
3. In DevTools, find the element's attributes:
   - Look for `id`, `class`, `aria-label`, `placeholder`, etc.
4. **Test the selector** in Console:
   ```javascript
   document.querySelector('your-selector-here')
   ```
   Should return the element (not null)

### Update Selectors File

Edit `/apps/automation-extension/content/panel-automation.js`:

```javascript
const SELECTORS = {
  // Login page
  LOGIN_USERNAME_INPUT: 'input[type="text"][aria-label="Nombre de Usuario"]',
  LOGIN_PASSWORD_INPUT: 'input[type="password"][aria-label="Contraseña"]',
  LOGIN_SUBMIT_BUTTON: 'button:contains("Ingresar")', // <-- Update this

  // Users page
  USER_SEARCH_INPUT: '#filter-input', // <-- And this
  ADD_CREDITS_BUTTON: 'button .fa-plus', // <-- And this

  // Modal
  MODAL: '.modal',
  MODAL_AMOUNT_INPUT: 'input[type="number"]',
  MODAL_SUBMIT_BUTTON: 'button:contains("Aceptar")',

  // Messages
  SUCCESS_MESSAGE: '.alert-success',
  ERROR_MESSAGE: '.alert-danger'
};
```

### Reload Extension After Changes

1. Go to `chrome://extensions/`
2. Click the refresh icon on the extension card
3. Extension reloads with new selectors

---

## What's Not Implemented Yet

### WebSocket Support

Currently using **polling only** (every 10 seconds). WebSocket would allow:
- Instant job notifications (no 10-second delay)
- Real-time communication with backend

To add WebSocket support, backend needs:
- WebSocket gateway for bot connections (separate from EventsGateway which is for web clients)
- Emit job events to connected bots

### Known Limitations

1. **Cloudflare Detection**: The HTML files you provided showed Cloudflare challenges. The extension should bypass these automatically since it's a real browser, but needs testing.

2. **Login Detection**: Current login check is generic. May need refinement based on actual panel structure.

3. **Success/Error Messages**: Selectors are guesses. Need to verify what actual success/error messages look like.

---

## Next Steps

1. **Test with real panel** to verify selectors work
2. **Adjust selectors** based on actual HTML structure
3. **(Optional) Add WebSocket gateway** to backend for instant job notifications
4. **Test end-to-end** with real credit load requests

---

## Production Deployment

Once testing succeeds:

1. **Package extension** for production:
   ```bash
   cd apps/automation-extension
   npm run package
   # Creates extension.zip
   ```

2. **Deploy to VPS**:
   - Install Chrome on server
   - Install extension
   - Configure with production credentials
   - Use systemd/PM2 to keep Chrome running
   - Use VNC/remote desktop to monitor

See `INSTALLATION.md` for detailed deployment guide.
