# Complete Business Flow - Game Automation Platform

**Last Updated:** January 18, 2026
**Status:** Production Ready

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Main Happy Path (Automatic)](#main-happy-path-automatic)
3. [Manual Review Path](#manual-review-path)
4. [Complete User Journey](#complete-user-journey)
5. [Validator App Flow](#validator-app-flow)
6. [Extension Bot Flow](#extension-bot-flow)
7. [Operator Dashboard Flow](#operator-dashboard-flow)
8. [Withdrawal Flow](#withdrawal-flow)
9. [Error Scenarios](#error-scenarios)
10. [System States & Transitions](#system-states--transitions)
11. [Security & Safety Checks](#security--safety-checks)
12. [Real-Time Notifications](#real-time-notifications)

---

## System Overview

### Architecture Components

```
┌─────────────┐  ┌──────────────┐  ┌─────────────┐
│  Chat App   │  │ Operator     │  │ Validator   │
│  (Mobile)   │  │ Panel (Web)  │  │ App (Desktop)│
└──────┬──────┘  └──────┬───────┘  └──────┬──────┘
       │                │                  │
       └────────────────┼──────────────────┘
                        │
                  ┌─────┴─────┐
                  │  Backend  │
                  │  (NestJS) │
                  └─────┬─────┘
                        │
                  ┌─────┴──────┐
                  │ Extension  │
                  │ Bot (Chrome)│
                  └────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communication |
|-----------|---------------|---------------|
| **Chat App** | User interface, proof upload | HTTP + Socket.IO |
| **Backend** | Orchestration, business logic | All components |
| **Validator App** | AI proof validation (Ollama) | Socket.IO `/validator` |
| **Extension Bot** | Credit loading automation | Socket.IO `/bot` + HTTP polling |
| **Operator Panel** | Manual review, supervision | HTTP + Socket.IO |

---

## Main Happy Path (Automatic)

### Flow Diagram

```
[User] ─────> [Chat App] ─────> [Backend] ─────> [Validator] ─────> [Backend] ─────> [Extension] ─────> [User]
   │              │                 │                  │                 │                  │              │
   1              2                 3                  4                 5                  6              7
```

### Detailed Steps

#### **Step 1: User Initiates Request**

**Location:** Chat App (Mobile)

**Actions:**
1. User opens chat interface
2. User fills form:
   - Target username: `john123` (their gaming panel username)
   - Amount: `$5000`
3. User submits request

**API Call:**
```http
POST /api/requests
Authorization: Bearer {user_jwt}
Content-Type: application/json

{
  "amount": 5000
}
```

**Backend Processing:**
1. Validate user is authenticated
2. Check user doesn't have 3+ pending requests
3. Check rate limit (max requests per hour)
4. Check amount ≤ MAX_REQUEST_AMOUNT (default $10,000)
5. Fetch user's username from database
6. Create request record

**Database:**
```sql
INSERT INTO Request (
  id, userId, targetUsername, amount, status, createdAt
) VALUES (
  'req_abc123', 'user_456', 'john123', 5000, 'PENDING_PROOF', NOW()
)
```

**Response:**
```json
{
  "id": "req_abc123",
  "userId": "user_456",
  "targetUsername": "john123",
  "amount": 5000,
  "status": "PENDING_PROOF",
  "createdAt": "2026-01-18T10:00:00Z"
}
```

**Real-Time Event:**
```javascript
socket.emit('request_created', {
  requestId: 'req_abc123',
  status: 'PENDING_PROOF'
})
```

**User Sees:**
- ✅ Request created successfully
- 📤 "Please upload payment proof"
- 💰 Amount: $5,000
- 👤 For user: john123

---

#### **Step 2: User Uploads Payment Proof**

**Location:** Chat App (Mobile)

**Actions:**
1. User takes photo or selects file (JPG/PNG/PDF)
2. App shows preview
3. User confirms upload

**API Call:**
```http
POST /api/requests/req_abc123/proof
Authorization: Bearer {user_jwt}
Content-Type: multipart/form-data

file: [payment_proof.jpg]
```

**Backend Processing:**
1. Validate file (max 10MB, allowed types: image/*, application/pdf)
2. Calculate file hash (SHA-256) for duplicate detection
3. Check if identical proof already used
4. Save file to uploads storage
5. Update request with proof URL and hash
6. Change status to VALIDATING
7. **Trigger async validation** (runs in background)

**Database:**
```sql
UPDATE Request SET
  proofUrl = '/uploads/file_789xyz',
  proofHash = 'sha256_hash...',
  status = 'VALIDATING',
  updatedAt = NOW()
WHERE id = 'req_abc123'
```

**Response:**
```json
{
  "id": "req_abc123",
  "status": "VALIDATING",
  "proofUrl": "/uploads/file_789xyz"
}
```

**Real-Time Event:**
```javascript
socket.emit('validation_started', {
  requestId: 'req_abc123',
  status: 'VALIDATING'
})
```

**User Sees:**
- ✅ Proof uploaded
- 🔍 "Validating payment proof..."
- ⏳ Progress indicator

---

#### **Step 3: Backend Sends Proof to Validator App**

**Location:** Backend → Validator App (via Socket.IO)

**Backend Processing:**
```typescript
async validateProof(requestId: string) {
  // 1. Get request and proof file
  const request = await prisma.request.findUnique({ where: { id: requestId } })
  const fileBuffer = await getFileBuffer(request.proofUrl)

  // 2. Check if validator is connected
  if (!validatorGateway.isValidatorConnected()) {
    // No validator → Manual review
    await setValidationResult(requestId, {
      valid: false,
      confidence: 0,
      error: 'Validador no conectado - requiere revisión manual'
    })
    return
  }

  // 3. Send to validator via Socket.IO
  const result = await validatorGateway.requestValidation(
    requestId,
    fileBuffer.toString('base64'),
    'image/jpeg',
    5000 // expectedAmount
  )

  // 4. Process result...
}
```

**Socket.IO Event (Backend → Validator):**
```javascript
socket.emit('validate', {
  id: 'val_xyz789',
  requestId: 'req_abc123',
  imageBase64: 'iVBORw0KGgoAAAANSUhEUgA...',
  mimeType: 'image/jpeg',
  expectedAmount: 5000
})
```

**Validator App Receives:**
1. Event arrives on Socket.IO connection
2. Add to validation queue (sequential processing)
3. If Ollama not available → Add to offline queue

---

#### **Step 4: Validator App Processes with AI**

**Location:** Validator App (Electron + Ollama)

**Processing:**
```javascript
async processValidationRequest(request) {
  // 1. Handle PDF conversion if needed
  if (request.mimeType === 'application/pdf') {
    const imageBase64 = await convertPdfToImage(request.imageBase64)
    request.imageBase64 = imageBase64
    request.mimeType = 'image/png'
  }

  // 2. Call Ollama Vision AI
  const result = await validateWithOllama(request)

  // 3. Send result back to backend
  socket.emit('validation_result', {
    id: request.id,
    requestId: request.requestId,
    isValid: result.isValid,
    confidence: result.confidence,
    extractedAmount: result.extractedAmount,
    extractedDate: result.extractedDate,
    paymentMethod: result.paymentMethod,
    reasoning: result.reasoning,
    flags: result.flags
  })
}
```

**Ollama AI Validation:**
```javascript
async validateWithOllama(request) {
  const prompt = `
    You are a payment proof validator. Analyze this payment receipt and extract:
    1. Payment amount (expected: ${request.expectedAmount})
    2. Payment date
    3. Payment method (e.g., MercadoPago, bank transfer)
    4. Determine if this is a legitimate payment proof

    Respond in JSON format with your analysis.
  `

  const response = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    body: JSON.stringify({
      model: 'llama3.2-vision',
      prompt,
      images: [request.imageBase64],
      stream: false
    })
  })

  const aiResponse = await response.json()
  const parsed = JSON.parse(aiResponse.response)

  return {
    isValid: parsed.amount === request.expectedAmount && parsed.isLegitimate,
    confidence: parsed.confidence,
    extractedAmount: parsed.amount,
    extractedDate: parsed.date,
    paymentMethod: parsed.paymentMethod,
    reasoning: parsed.reasoning,
    flags: parsed.flags || []
  }
}
```

**Typical AI Response (Valid):**
```json
{
  "isValid": true,
  "confidence": 0.95,
  "extractedAmount": 5000,
  "extractedDate": "2026-01-18",
  "paymentMethod": "MercadoPago",
  "reasoning": "Payment proof shows MercadoPago transfer for $5000, dated today, appears authentic",
  "flags": []
}
```

**Typical AI Response (Invalid):**
```json
{
  "isValid": false,
  "confidence": 0.45,
  "extractedAmount": 3000,
  "extractedDate": "2026-01-10",
  "paymentMethod": "MercadoPago",
  "reasoning": "Amount mismatch: expected $5000 but found $3000",
  "flags": ["AMOUNT_MISMATCH"]
}
```

---

#### **Step 5: Backend Processes Validation Result**

**Location:** Backend API

**Processing:**
```typescript
// Backend receives validation result
handleValidationResult(result: ValidationResult) {
  const {
    isValid,
    confidence,
    extractedAmount,
    extractedDate,
    paymentMethod,
    reasoning,
    flags
  } = result

  // Get settings
  const threshold = 0.8 // Configurable
  const dateWindowDays = 7 // Configurable

  // Check date validity
  const proofDate = new Date(extractedDate)
  const daysDiff = Math.floor((Date.now() - proofDate.getTime()) / (1000 * 60 * 60 * 24))

  let dateValid = true
  if (daysDiff > dateWindowDays) {
    flags.push('OLD_DATE')
    dateValid = false
  } else if (daysDiff < 0) {
    flags.push('FUTURE_DATE', 'SUSPICIOUS')
    dateValid = false
  }

  // Final decision
  const meetsThreshold = confidence >= threshold
  const finalValid = isValid && meetsThreshold && dateValid

  if (finalValid) {
    // ✅ AUTO-APPROVE
    await updateRequestStatus(requestId, 'APPROVED')
    await createJobForRequest(requestId)
  } else {
    // ❌ MANUAL REVIEW REQUIRED
    await updateRequestStatus(requestId, 'VALIDATION_FAILED', reasoning)
  }
}
```

**Database Update (Valid):**
```sql
UPDATE Request SET
  status = 'APPROVED',
  validationScore = 0.95,
  validationDetails = '{"extractedAmount": 5000, "extractedDate": "2026-01-18", ...}',
  updatedAt = NOW()
WHERE id = 'req_abc123'

-- Create Job
INSERT INTO Job (
  id, requestId, status, createdAt
) VALUES (
  'job_def456', 'req_abc123', 'QUEUED', NOW()
)
```

**Real-Time Event (Valid):**
```javascript
socket.emit('validation_completed', {
  requestId: 'req_abc123',
  status: 'APPROVED',
  score: 0.95
})

socket.emit('job_created', {
  jobId: 'job_def456',
  requestId: 'req_abc123'
})
```

**User Sees:**
- ✅ "Payment verified!"
- 🎯 Confidence: 95%
- 🚀 "Processing credit load..."

---

#### **Step 6: Extension Bot Receives Job**

**Location:** Extension Bot (Chrome Extension)

**Job Dispatch (Backend):**
```typescript
async tryDispatchNextJob() {
  // Safety checks
  const killSwitch = await checkKillSwitch()
  if (killSwitch.active) return

  const activityWindow = await checkActivityWindow()
  if (!activityWindow.allowed) return

  const activeJob = await getActiveJob()
  if (activeJob) return // Only 1 job at a time

  const cooldown = await checkCooldown() // 30s between jobs
  if (!cooldown.ready) return

  // Get next queued job
  const job = await prisma.job.findFirst({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
    include: { request: true }
  })

  if (!job) return

  // Send to extension (WebSocket or polling)
  if (botGateway.isBotConnected()) {
    botGateway.sendJob(job) // WebSocket
  } else {
    // Job waits for polling
  }
}
```

**WebSocket Event (Backend → Extension):**
```javascript
socket.emit('new_job', {
  jobId: 'job_def456',
  requestId: 'req_abc123',
  targetUsername: 'john123',
  amount: 5000
})
```

**OR Polling (Extension → Backend):**
```http
GET /api/bot/jobs/pending
X-Bot-API-Key: {api_key}

Response:
{
  "job": {
    "jobId": "job_def456",
    "requestId": "req_abc123",
    "targetUsername": "john123",
    "amount": 5000
  }
}
```

**Extension Processing:**
```javascript
async handleNewJob(job) {
  console.log('[Extension] Received job:', job.jobId)

  // 1. Report started
  await apiClient.reportJobStarted(config, job.jobId)

  // 2. Execute job
  try {
    const result = await jobProcessor.execute(job, config)

    // 3. Report success
    await apiClient.reportJobResult(config, job.jobId, {
      success: true,
      targetUsername: job.targetUsername,
      amount: job.amount
    })
  } catch (error) {
    // 4. Report failure (with screenshot)
    const screenshot = await chrome.tabs.captureVisibleTab()
    const screenshotPath = await apiClient.uploadScreenshot(config, job.jobId, screenshot)

    await apiClient.reportJobResult(config, job.jobId, {
      success: false,
      error: error.message,
      screenshotPath
    })
  }
}
```

**Job Execution Steps:**
```javascript
async execute(job, config) {
  // 1. Open/focus panel tab
  const tab = await ensurePanelTab(config.panelUrl)

  // 2. Wait for tab to load
  await waitForTabLoad(tab.id)

  // 3. Validate session (login if needed)
  await validateSession(tab.id, config)

  // 4. Execute credit loading
  const result = await executeLoadCredits(tab.id, job, config)

  return result
}

async validateSession(tabId, config, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const isLoggedIn = await checkLoginStatus(tabId)

    if (isLoggedIn) {
      return true
    }

    // Session expired - re-login
    await performLogin(tabId, config)

    const loginSuccess = await checkLoginStatus(tabId)
    if (loginSuccess) {
      return true
    }

    if (attempt < maxAttempts) {
      await sleep(2000)
    }
  }

  throw new Error('Session validation failed after 3 attempts')
}

async executeLoadCredits(tabId, job, config) {
  // Inject content scripts
  await injectContentScripts(tabId, config)

  // Execute automation
  const result = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (jobData) => {
      return await window.panelAutomation.loadCredits(jobData)
    },
    args: [{
      targetUsername: job.targetUsername,
      amount: job.amount
    }]
  })

  if (!result[0].result.success) {
    const screenshot = await chrome.tabs.captureVisibleTab()
    const error = new Error(`Credit load failed: ${result[0].result.error}`)
    error.screenshot = screenshot
    throw error
  }

  return result[0].result
}
```

**Panel Automation (Content Script):**
```javascript
async loadCredits(jobData) {
  const context = {
    targetUsername: jobData.targetUsername,
    amount: jobData.amount
  }

  try {
    // Step 1: Navigate to users page
    await executeStep('navigate_to_users_page', async () => {
      if (!window.location.pathname.includes('/users')) {
        const usersLink = await humanize.waitForElement(SELECTORS.USERS_PAGE_LINK)
        await humanize.clickElement(usersLink)
        await humanize.waitForNavigation()
      }
    }, context)

    // Step 2: Search for user
    await executeStep('search_for_user', async () => {
      const searchInput = await humanize.waitForElementReady(SELECTORS.USER_SEARCH_INPUT)
      searchInput.value = ''
      await humanize.typeIntoElement(searchInput, jobData.targetUsername)
      await humanize.randomDelay(1000, 2000)
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    }, { ...context, selector: SELECTORS.USER_SEARCH_INPUT })

    // Step 3: Click add credits button
    await executeStep('click_add_credits_button', async () => {
      const addButton = await humanize.waitForElementReady(SELECTORS.ADD_CREDITS_BUTTON)
      await humanize.clickElement(addButton)
    }, { ...context, selector: SELECTORS.ADD_CREDITS_BUTTON })

    // Step 4: Wait for modal
    await executeStep('wait_for_modal', async () => {
      await humanize.waitForElement(SELECTORS.MODAL)
    }, context)

    // Step 5: Fill amount
    await executeStep('fill_amount', async () => {
      const amountInput = await humanize.waitForElementReady(SELECTORS.MODAL_AMOUNT_INPUT)
      amountInput.value = ''
      await humanize.typeIntoElement(amountInput, jobData.amount.toString())
      await humanize.randomDelay(3000, 5000) // Review pause
    }, { ...context, selector: SELECTORS.MODAL_AMOUNT_INPUT })

    // Step 6: Submit
    await executeStep('submit_form', async () => {
      const submitButton = await humanize.waitForElementWithText('button', 'Aceptar')
      await humanize.clickElement(submitButton)
    }, context)

    // Step 7: Wait for result
    return await executeStep('wait_for_result', async () => {
      const startTime = Date.now()
      const timeout = 10000

      while (Date.now() - startTime < timeout) {
        // Check error first
        const errorMsg = document.querySelector(SELECTORS.ERROR_MESSAGE)
        if (errorMsg && errorMsg.offsetParent !== null) {
          throw new Error(`Panel error: ${errorMsg.textContent.trim()}`)
        }

        // Check success
        const successMsg = document.querySelector(SELECTORS.SUCCESS_MESSAGE)
        if (successMsg && successMsg.offsetParent !== null) {
          return {
            success: true,
            targetUsername: jobData.targetUsername,
            amount: jobData.amount,
            message: successMsg.textContent.trim()
          }
        }

        // Check modal closed
        const modal = document.querySelector(SELECTORS.MODAL)
        if (!modal || modal.offsetParent === null) {
          return {
            success: true,
            targetUsername: jobData.targetUsername,
            amount: jobData.amount,
            message: 'Credits added successfully (modal closed)'
          }
        }

        await new Promise(resolve => setTimeout(resolve, 100))
      }

      throw new Error('Timeout waiting for result')
    }, context)

  } catch (error) {
    return {
      success: false,
      error: error.message
    }
  }
}
```

**Backend Receives Result:**
```http
POST /api/bot/jobs/job_def456/result
X-Bot-API-Key: {api_key}

{
  "success": true,
  "targetUsername": "john123",
  "amount": 5000,
  "message": "Créditos agregados exitosamente"
}
```

**Backend Processing:**
```typescript
async handleJobResult(jobId: string, dto: JobResultDto) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { request: true }
  })

  // Update job
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: dto.success ? 'COMPLETED' : 'FAILED',
      completedAt: new Date(),
      result: dto.success ? { success: true } : undefined,
      error: dto.error || undefined,
      screenshot: dto.screenshotPath || undefined
    }
  })

  // Update request
  await prisma.request.update({
    where: { id: job.requestId },
    data: { status: dto.success ? 'COMPLETED' : 'FAILED' }
  })

  // Add balance on success
  if (dto.success) {
    // Check if balance already added
    const existingTransaction = await prisma.transaction.findFirst({
      where: { requestId: job.requestId }
    })

    if (!existingTransaction) {
      await balanceService.addBalance(
        job.request.userId,
        Number(job.request.amount),
        job.requestId,
        `Carga de fichas completada - ${job.request.targetUsername}`
      )
    }
  }

  // Emit events
  if (dto.success) {
    eventsGateway.emitJobCompleted(job.request.userId, {
      jobId,
      requestId: job.requestId,
      targetUsername: job.request.targetUsername,
      amount: Number(job.request.amount)
    })
  } else {
    eventsGateway.emitJobFailed(job.request.userId, {
      jobId,
      requestId: job.requestId,
      error: dto.error
    })
  }
}
```

**Database Update:**
```sql
UPDATE Job SET
  status = 'COMPLETED',
  completedAt = NOW(),
  result = '{"success": true}'
WHERE id = 'job_def456'

UPDATE Request SET
  status = 'COMPLETED',
  updatedAt = NOW()
WHERE id = 'req_abc123'

-- Update user balance
UPDATE User SET
  balance = balance + 5000
WHERE id = 'user_456'

-- Create transaction record
INSERT INTO Transaction (
  id, userId, type, amount, balanceBefore, balanceAfter,
  requestId, description, createdAt
) VALUES (
  'txn_ghi789', 'user_456', 'CREDIT_LOAD', 5000, 0, 5000,
  'req_abc123', 'Carga de fichas completada - john123', NOW()
)
```

---

#### **Step 7: User Receives Confirmation**

**Location:** Chat App (Mobile)

**Real-Time Events:**
```javascript
// Job completed
socket.on('job_completed', (data) => {
  showNotification({
    title: '✅ Credits Loaded!',
    message: `$${data.amount} added to ${data.targetUsername}`,
    type: 'success'
  })

  // Update UI
  updateRequestStatus(data.requestId, 'COMPLETED')
  refreshBalance()
})

// Request completed
socket.on('request_completed', (data) => {
  updateRequestStatus(data.requestId, 'COMPLETED')
})
```

**User Sees:**
- ✅ "Credits loaded successfully!"
- 💰 $5,000 added to john123
- 💳 New balance: $5,000
- 📋 Transaction history updated
- 🔔 Push notification

**Timeline Display:**
```
📝 Request created - 10:00 AM
📤 Proof uploaded - 10:02 AM
🔍 Validation started - 10:02 AM
✅ Validation completed (95%) - 10:03 AM
🚀 Job created - 10:03 AM
⚙️  Processing credit load - 10:04 AM
✅ Completed successfully - 10:05 AM
💰 Balance updated: $5,000 - 10:05 AM
```

---

## Manual Review Path

### When Manual Review is Triggered

**Automatic → Manual Review Triggers:**
1. **Low AI confidence** (< 0.8 threshold)
2. **Amount mismatch** (extracted ≠ requested)
3. **Date too old** (> 7 days)
4. **Future date** (suspicious)
5. **Duplicate proof** (hash already used)
6. **Validator offline** (no connection)
7. **AI error** (validation timeout or failure)
8. **Suspicious flags** (AI detected anomalies)

### Manual Review Flow

```
Request status: VALIDATION_FAILED
         ↓
Goes to Operator Review Queue
         ↓
┌────────────────────────────┐
│  Operator Reviews:         │
│  • Payment proof image/PDF │
│  • AI validation details   │
│  • User information        │
│  • Amount requested        │
│  • Reason for failure      │
└────────────────────────────┘
         ↓
    Operator Decides
         ↓
    ┌────┴────┐
    │         │
    ✅        ❌
 APPROVE   REJECT
    │         │
    └────┬────┘
         ↓
```

#### Operator Approval

**Location:** Operator Panel

**Operator Actions:**
1. Navigate to "Failed Validations" page
2. Click on request to view details
3. Review payment proof (full image viewer)
4. Review AI analysis:
   ```
   Confidence: 0.65 (Below threshold 0.8)
   Extracted Amount: $5,000 ✅
   Extracted Date: 2026-01-18 ✅
   Payment Method: MercadoPago
   Flags: [LOW_QUALITY_IMAGE]
   Reasoning: "Image quality is low but amount and date are correct"
   ```
5. Make decision: **Approve**

**API Call:**
```http
POST /api/requests/req_abc123/approve
Authorization: Bearer {operator_jwt}
Content-Type: application/json

{
  "notes": "Image quality low but amount verified"
}
```

**Backend Processing:**
```typescript
async approve(requestId: string, operatorId: string, dto?: ApproveRequestDto) {
  // Update request
  await prisma.request.update({
    where: { id: requestId },
    data: {
      status: 'APPROVED',
      manuallyApproved: true,
      approvedById: operatorId,
      approvedAt: new Date()
    }
  })

  // Create job (same as automatic approval)
  await jobsService.createJobForRequest(requestId)

  // Log audit trail
  await auditLog.create({
    operatorId,
    action: 'MANUAL_APPROVAL',
    entityType: 'REQUEST',
    entityId: requestId,
    metadata: { notes: dto?.notes }
  })

  // Emit events
  eventsGateway.emitRequestUpdated(request.userId, {
    requestId,
    status: 'APPROVED'
  })
}
```

**After Approval:**
- Request status → APPROVED (manuallyApproved=true)
- Job created → QUEUED
- Extension bot receives job
- **Same flow as automatic approval from Step 6 onwards**

#### Operator Rejection

**API Call:**
```http
POST /api/requests/req_abc123/reject
Authorization: Bearer {operator_jwt}
Content-Type: application/json

{
  "reason": "Invalid payment proof - amount does not match"
}
```

**Backend Processing:**
```typescript
async reject(requestId: string, operatorId: string, dto: RejectRequestDto) {
  await prisma.request.update({
    where: { id: requestId },
    data: {
      status: 'REJECTED',
      rejectionReason: dto.reason,
      approvedById: operatorId,
      approvedAt: new Date()
    }
  })

  // Log audit trail
  await auditLog.create({
    operatorId,
    action: 'MANUAL_REJECTION',
    entityType: 'REQUEST',
    entityId: requestId,
    metadata: { reason: dto.reason }
  })

  // Notify user
  eventsGateway.emitRequestUpdated(request.userId, {
    requestId,
    status: 'REJECTED',
    reason: dto.reason
  })
}
```

**User Notification:**
```javascript
socket.on('request_updated', (data) => {
  if (data.status === 'REJECTED') {
    showNotification({
      title: '❌ Request Rejected',
      message: data.reason,
      type: 'error'
    })
  }
})
```

**User Sees:**
- ❌ Request rejected
- 📝 Reason: "Invalid payment proof - amount does not match"
- 🔄 "You can create a new request"

---

## Complete User Journey

### Timeline View

```
Day 1 - 10:00 AM: User creates request ($5,000)
         Status: PENDING_PROOF

Day 1 - 10:02 AM: User uploads payment proof
         Status: VALIDATING

Day 1 - 10:03 AM: AI validation completes (95% confidence)
         Status: APPROVED

Day 1 - 10:03 AM: Job created and queued
         Job Status: QUEUED

Day 1 - 10:04 AM: Extension bot receives job
         Job Status: PROCESSING
         Request Status: PROCESSING

Day 1 - 10:05 AM: Credits loaded successfully
         Job Status: COMPLETED
         Request Status: COMPLETED
         Balance: +$5,000
```

### User Experience Points

**Mobile App UI States:**

1. **Initial State**
   ```
   ┌─────────────────────────┐
   │  My Requests            │
   │  ───────────────────    │
   │  No requests yet        │
   │                         │
   │  [+ New Request]        │
   └─────────────────────────┘
   ```

2. **Creating Request**
   ```
   ┌─────────────────────────┐
   │  New Request            │
   │  ───────────────────    │
   │  Amount: $___________   │
   │                         │
   │  [Submit Request]       │
   └─────────────────────────┘
   ```

3. **Pending Proof**
   ```
   ┌─────────────────────────┐
   │  Request #ABC123        │
   │  ───────────────────    │
   │  📤 Upload Payment Proof│
   │                         │
   │  Amount: $5,000         │
   │  Status: Pending Proof  │
   │                         │
   │  [Upload Photo]         │
   └─────────────────────────┘
   ```

4. **Validating**
   ```
   ┌─────────────────────────┐
   │  Request #ABC123        │
   │  ───────────────────    │
   │  🔍 Validating...       │
   │  [Progress Spinner]     │
   │                         │
   │  Amount: $5,000         │
   │  Proof: [thumbnail]     │
   └─────────────────────────┘
   ```

5. **Processing**
   ```
   ┌─────────────────────────┐
   │  Request #ABC123        │
   │  ───────────────────    │
   │  ⚙️ Processing Credits  │
   │  [Progress Spinner]     │
   │                         │
   │  Amount: $5,000         │
   │  Validated: ✅ 95%      │
   └─────────────────────────┘
   ```

6. **Completed**
   ```
   ┌─────────────────────────┐
   │  Request #ABC123        │
   │  ───────────────────    │
   │  ✅ Completed!          │
   │                         │
   │  Amount: $5,000         │
   │  Balance: $5,000        │
   │  Completed: 10:05 AM    │
   │                         │
   │  [View Receipt]         │
   └─────────────────────────┘
   ```

7. **Failed Validation**
   ```
   ┌─────────────────────────┐
   │  Request #ABC123        │
   │  ───────────────────    │
   │  ⚠️  Manual Review      │
   │                         │
   │  Amount: $5,000         │
   │  Reason: Low confidence │
   │                         │
   │  An operator will       │
   │  review your proof      │
   │  shortly.               │
   └─────────────────────────┘
   ```

---

## Validator App Flow

### Startup Sequence

```
1. App launches
   ↓
2. Check Ollama installation
   ├─ ✅ Installed → Check if running
   │  ├─ ✅ Running → Check vision models
   │  │  ├─ ✅ Has vision model → Ready
   │  │  └─ ❌ No vision model → Auto-download llava
   │  └─ ❌ Not running → Try to start ollama serve
   └─ ❌ Not installed → Show download instructions

3. Load configuration
   ├─ Backend URL
   ├─ API Key
   └─ Ollama settings

4. Connect to Backend (Socket.IO)
   ├─ Send API key for authentication
   └─ If another validator connected → Rejected

5. Start heartbeat (every 30s)

6. Ready to receive validation requests
```

### Validation Processing

```
Request received via Socket.IO 'validate' event
         ↓
Check if Ollama available
         ├─ ❌ Not available → Add to offline queue
         └─ ✅ Available → Continue
         ↓
Add to validation queue (sequential)
         ↓
Check if already processing
         ├─ ✅ Yes → Wait in queue
         └─ ❌ No → Start processing
         ↓
Handle PDF conversion (if needed)
         ├─ Check if poppler installed
         ├─ Convert PDF → PNG
         └─ Or fail with manual review flag
         ↓
Call Ollama Vision API
         ├─ Send image + prompt
         ├─ Wait for response (max 60s)
         └─ Parse JSON response
         ↓
Send result back to Backend
         ├─ Socket.IO 'validation_result' event
         └─ Log result locally
         ↓
Process next in queue (if any)
```

### Offline Queue

**When Validator Disconnects:**
1. Backend routes new validations to manual review
2. Existing pending validations wait in validator's offline queue

**When Validator Reconnects:**
1. Socket.IO reconnects automatically (with exponential backoff)
2. Process offline queue sequentially
3. Send results for each queued validation

**Queue Persistence:**
```javascript
// Saved to disk
const offlineQueuePath = path.join(userDataPath, 'offline-queue.json')

// On app close
fs.writeFileSync(offlineQueuePath, JSON.stringify(offlineQueue))

// On app start
if (fs.existsSync(offlineQueuePath)) {
  offlineQueue = JSON.parse(fs.readFileSync(offlineQueuePath))
}
```

---

## Extension Bot Flow

### Startup Sequence

```
1. Extension loads (service worker)
   ↓
2. Load configuration from chrome.storage
   ├─ Backend URL
   ├─ API Key
   ├─ Panel URL
   ├─ Panel credentials
   └─ Automation settings
   ↓
3. Attempt WebSocket connection
   ├─ ✅ Connected → WebSocket mode
   └─ ❌ Failed → Polling mode
   ↓
4. Start heartbeat (every 60s)
   ↓
5. If polling mode → Poll every 10s for jobs
   ↓
6. Ready to receive jobs
```

### Job Execution

```
Job received (WebSocket or polling)
         ↓
Report job started to Backend
         ├─ POST /bot/jobs/:id/started
         └─ Job status → PROCESSING
         ↓
Open/focus gaming panel tab
         ├─ Check if tab already exists
         ├─ Create new tab if needed
         └─ Wait for page load
         ↓
Validate session
         ├─ Check if logged in (look for user menu)
         ├─ If not logged in → Perform login
         │  ├─ Wait for login form
         │  ├─ Fill username & password
         │  ├─ Submit form
         │  ├─ Wait for navigation
         │  └─ Verify login success
         └─ If login fails 3 times → Fail job
         ↓
Inject content scripts
         ├─ humanize.js (human-like behavior)
         └─ panel-automation.js (DOM manipulation)
         ↓
Execute credit loading automation
         ├─ Navigate to users page
         ├─ Search for target user
         ├─ Click "Add Credits" button
         ├─ Wait for modal
         ├─ Fill amount
         ├─ Review pause (3-5 seconds)
         ├─ Click "Aceptar"
         └─ Wait for result (success/error message or modal close)
         ↓
Report result to Backend
         ├─ POST /bot/jobs/:id/result
         ├─ Include success/failure
         ├─ Include error message if failed
         └─ Upload screenshot if failed
         ↓
Wait for cooldown (30s)
         ↓
Ready for next job
```

### Error Handling

**Session Validation Failure:**
```
1. Attempt 1: Try to login
   ├─ Success → Continue
   └─ Fail → Wait 2s, retry

2. Attempt 2: Try to login
   ├─ Success → Continue
   └─ Fail → Wait 2s, retry

3. Attempt 3: Try to login
   ├─ Success → Continue
   └─ Fail → Report job failure
      ├─ Error: "Session validation failed after 3 attempts"
      └─ Screenshot captured
```

**Credit Load Failure:**
```
Panel returns error (e.g., "Usuario no encontrado")
         ↓
Capture error message text
         ↓
Capture screenshot
         ↓
Report to Backend:
{
  success: false,
  error: "Failed at search_for_user (targetUsername=\"john123\"): Usuario no encontrado",
  screenshotPath: "/screenshots/job_def456_error.png"
}
         ↓
Job status → FAILED
Request status → FAILED
         ↓
Operator notified for manual review
```

---

## Operator Dashboard Flow

### Dashboard Overview

```
┌────────────────────────────────────────┐
│  Game Automation Platform - Operator   │
├────────────────────────────────────────┤
│                                        │
│  📊 Statistics                         │
│  ┌──────┬──────┬──────┬──────┐       │
│  │ 25   │ 3    │ 120  │ 5    │       │
│  │Queue │Active│Done  │Failed│       │
│  └──────┴──────┴──────┴──────┘       │
│                                        │
│  ⚠️  Failed Validations (5)           │
│  ┌────────────────────────────────┐  │
│  │ #ABC123  $5,000  Low confidence│  │
│  │ #DEF456  $3,000  Amount mismatch│  │
│  │ [View All]                      │  │
│  └────────────────────────────────┘  │
│                                        │
│  🤖 Bot Status: ✅ Online             │
│  📱 Validator: ✅ Connected            │
│                                        │
└────────────────────────────────────────┘
```

### Key Operator Actions

#### 1. Review Failed Validation

**Navigation:**
```
Dashboard → Failed Validations → Click Request
```

**Detail View:**
```
┌────────────────────────────────────────┐
│  Request #ABC123                       │
├────────────────────────────────────────┤
│                                        │
│  User: user@example.com                │
│  Amount: $5,000                        │
│  Target: john123                       │
│  Created: Jan 18, 2026 10:00 AM       │
│                                        │
│  📷 Payment Proof                      │
│  [Image viewer with zoom]              │
│                                        │
│  🤖 AI Validation                      │
│  Confidence: 0.65 (Below 0.8)         │
│  Extracted Amount: $5,000 ✅          │
│  Extracted Date: 2026-01-18 ✅        │
│  Flags: [LOW_QUALITY_IMAGE]           │
│  Reasoning: "Image quality is low but │
│              amount and date correct"  │
│                                        │
│  📝 Notes (optional)                   │
│  [Text area]                           │
│                                        │
│  [✅ Approve]  [❌ Reject]            │
│                                        │
└────────────────────────────────────────┘
```

#### 2. Monitor Active Jobs

**Real-time Updates:**
```
Socket.IO events:
- 'job_started' → Update job list
- 'job_progress' → Update progress bar
- 'job_completed' → Move to completed
- 'job_failed' → Move to failed, show alert
```

**Active Jobs View:**
```
┌────────────────────────────────────────┐
│  Active Jobs (3)                       │
├────────────────────────────────────────┤
│  #JOB123  john123  $5,000             │
│  Step: fill_amount                     │
│  Progress: ████████░░ 80%             │
│                                        │
│  #JOB124  jane456  $3,000             │
│  Step: search_for_user                 │
│  Progress: ████░░░░░░ 40%             │
│                                        │
└────────────────────────────────────────┘
```

#### 3. Handle Failed Jobs

**Failed Job Alert:**
```
🚨 Job #JOB125 Failed
User: mary789
Amount: $2,000
Error: "Failed at search_for_user: Usuario no encontrado"

[View Screenshot]  [Retry]  [Mark as Manual]
```

**Operator Options:**
1. **View Screenshot** - See exactly what happened
2. **Retry** - Requeue the job (if transient error)
3. **Mark as Manual** - Process manually, mark as completed

#### 4. System Monitoring

**Health Dashboard:**
```
┌────────────────────────────────────────┐
│  System Health                         │
├────────────────────────────────────────┤
│  🤖 Extension Bot                      │
│  Status: ✅ Online                     │
│  Last Heartbeat: 2 seconds ago        │
│  Current Job: #JOB123                 │
│                                        │
│  📱 Validator App                      │
│  Status: ✅ Connected                  │
│  Last Heartbeat: 5 seconds ago        │
│  Queue: 2 pending                     │
│                                        │
│  🔧 Kill Switch: ❌ Inactive          │
│  [Activate Emergency Stop]            │
│                                        │
└────────────────────────────────────────┘
```

---

## Withdrawal Flow

### User Initiates Withdrawal

**Location:** Chat App

**User Actions:**
1. Navigate to "Withdraw" section
2. Check current balance: $5,000
3. Fill form:
   - Amount: $2,000
   - Payment method: MercadoPago
   - Account details: email@example.com
4. Submit withdrawal request

**API Call:**
```http
POST /api/withdrawals
Authorization: Bearer {user_jwt}
Content-Type: application/json

{
  "amount": 2000,
  "paymentMethod": "MERCADOPAGO",
  "accountDetails": {
    "email": "email@example.com"
  }
}
```

**Backend Validation:**
```typescript
async create(userId: string, dto: CreateWithdrawalDto) {
  // Check user balance
  const user = await prisma.user.findUnique({ where: { id: userId } })

  if (Number(user.balance) < dto.amount) {
    throw new BadRequestException('Saldo insuficiente')
  }

  // Check minimum withdrawal amount
  const minAmount = await getMinWithdrawalAmount() // e.g., $100
  if (dto.amount < minAmount) {
    throw new BadRequestException(`Monto mínimo: $${minAmount}`)
  }

  // Check pending withdrawals
  const pendingCount = await prisma.withdrawal.count({
    where: {
      userId,
      status: { in: ['PENDING', 'APPROVED'] }
    }
  })

  if (pendingCount >= 3) {
    throw new BadRequestException('Ya tienes retiros pendientes')
  }

  // Create withdrawal
  const withdrawal = await prisma.withdrawal.create({
    data: {
      userId,
      amount: dto.amount,
      paymentMethod: dto.paymentMethod,
      accountDetails: dto.accountDetails,
      status: 'PENDING'
    }
  })

  return withdrawal
}
```

**Response:**
```json
{
  "id": "wdr_xyz789",
  "userId": "user_456",
  "amount": 2000,
  "paymentMethod": "MERCADOPAGO",
  "accountDetails": {
    "email": "email@example.com"
  },
  "status": "PENDING",
  "createdAt": "2026-01-18T14:00:00Z"
}
```

**User Sees:**
- ✅ Withdrawal request created
- 💰 Amount: $2,000
- 📝 Status: Pending approval
- ⏳ "An operator will process your withdrawal"

### Operator Processes Withdrawal

**Operator Dashboard:**
```
┌────────────────────────────────────────┐
│  Pending Withdrawals (5)               │
├────────────────────────────────────────┤
│  #WDR123  $2,000  MercadoPago         │
│  User: user@example.com               │
│  Account: email@example.com           │
│  Requested: Jan 18, 2:00 PM           │
│                                        │
│  [✅ Approve]  [❌ Reject]            │
└────────────────────────────────────────┘
```

**Operator Approves:**
```http
POST /api/withdrawals/wdr_xyz789/approve
Authorization: Bearer {operator_jwt}
Content-Type: application/json

{
  "transactionId": "MP_TXN_12345",
  "notes": "Paid via MercadoPago"
}
```

**Backend Processing:**
```typescript
async approve(withdrawalId: string, operatorId: string, dto: ApproveWithdrawalDto) {
  return await prisma.$transaction(async (tx) => {
    // Update withdrawal
    const withdrawal = await tx.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'APPROVED',
        approvedById: operatorId,
        approvedAt: new Date(),
        transactionId: dto.transactionId
      }
    })

    // Deduct balance
    const user = await tx.user.findUnique({
      where: { id: withdrawal.userId },
      select: { balance: true }
    })

    const balanceBefore = Number(user.balance)
    const balanceAfter = balanceBefore - Number(withdrawal.amount)

    await tx.user.update({
      where: { id: withdrawal.userId },
      data: { balance: balanceAfter }
    })

    // Create transaction record
    await tx.transaction.create({
      data: {
        userId: withdrawal.userId,
        type: 'WITHDRAWAL',
        amount: Number(withdrawal.amount) * -1,
        balanceBefore,
        balanceAfter,
        withdrawalId: withdrawal.id,
        description: `Retiro de ${withdrawal.paymentMethod} - Aprobado`
      }
    })

    // Log audit trail
    await tx.auditLog.create({
      data: {
        operatorId,
        action: 'WITHDRAWAL_APPROVED',
        entityType: 'WITHDRAWAL',
        entityId: withdrawalId,
        metadata: { transactionId: dto.transactionId }
      }
    })

    return withdrawal
  })
}
```

**User Notification:**
```javascript
socket.emit('withdrawal_approved', {
  withdrawalId: 'wdr_xyz789',
  amount: 2000,
  transactionId: 'MP_TXN_12345',
  newBalance: 3000
})
```

**User Sees:**
- ✅ Withdrawal approved!
- 💰 $2,000 paid to email@example.com
- 📝 Transaction ID: MP_TXN_12345
- 💳 New balance: $3,000
- 📋 Transaction history updated

---

## Error Scenarios

### 1. Validator App Offline

**Flow:**
```
User uploads proof
         ↓
Backend checks validator connection
         ↓
❌ Validator offline
         ↓
Request status → VALIDATION_FAILED
Reason: "Validador no conectado"
         ↓
Goes to manual review queue
         ↓
Operator reviews and approves/rejects manually
```

**User Experience:**
- ⚠️  "Your proof is under manual review"
- 👤 "An operator will review it shortly"
- ⏳ Waiting for operator

### 2. Extension Bot Offline

**Flow:**
```
Validator approves proof
         ↓
Job created → QUEUED
         ↓
Backend tries to dispatch job
         ↓
❌ Extension bot offline
         ↓
Job stays in queue (not dispatched)
         ↓
When bot comes back online:
  ├─ Heartbeat received
  ├─ Backend dispatches queued job
  └─ Job processed normally
```

**User Experience:**
- ✅ "Payment verified!"
- ⚙️  "Processing credit load..." (shows spinner)
- ⏳ Waiting for bot to come online
- ✅ "Credits loaded!" (when bot processes)

### 3. Duplicate Payment Proof

**Flow:**
```
User uploads proof
         ↓
Backend calculates hash
         ↓
Check if hash exists in database
         ↓
❌ Hash already used for another request
         ↓
Reject upload with error
```

**User Sees:**
- ❌ "This payment proof has already been used"
- 📝 "Please upload a different payment proof"
- 🔄 Upload button still available

### 4. Job Execution Failure

**Scenario: User Not Found in Panel**

**Flow:**
```
Extension executes job
         ↓
Step: search_for_user
         ↓
Search for "john123" in panel
         ↓
❌ User not found (panel shows error)
         ↓
Automation detects error message
         ↓
Captures screenshot
         ↓
Reports failure to backend:
{
  success: false,
  error: "Failed at search_for_user (targetUsername=\"john123\"): Usuario no encontrado"
}
         ↓
Job status → FAILED
Request status → FAILED
         ↓
Operator notified
```

**Operator Sees:**
```
🚨 Job Failed Alert
━━━━━━━━━━━━━━━━━━━━━
Job ID: #JOB125
User: user@example.com
Target: john123
Amount: $5,000
Error: Usuario no encontrado

[View Screenshot]
[Contact User]
[Mark as Processed]
```

**Operator Actions:**
1. View screenshot - see panel error
2. Contact user - "Your username 'john123' was not found in the gaming panel. Please verify your username."
3. User provides correct username
4. Operator creates manual request with correct username

### 5. Session Expired During Job

**Flow:**
```
Extension receives job
         ↓
Open panel tab
         ↓
Session validation check
         ↓
❌ Session expired (no user menu found)
         ↓
Attempt 1: Auto-login
  ├─ Fill credentials
  ├─ Submit
  └─ Verify login
         ↓
✅ Login successful
         ↓
Continue with credit loading
         ↓
✅ Job completes successfully
```

**If Auto-login Fails:**
```
Attempt 1: Failed
         ↓
Wait 2 seconds
         ↓
Attempt 2: Failed
         ↓
Wait 2 seconds
         ↓
Attempt 3: Failed
         ↓
Report job failure:
{
  success: false,
  error: "Session validation failed after 3 attempts"
}
         ↓
Operator investigates:
  - Panel credentials changed?
  - Panel login page changed?
  - Captcha added?
```

### 6. Kill Switch Activated

**Flow:**
```
Operator activates kill switch
         ↓
POST /api/bot/kill-switch
{
  "active": true,
  "reason": "Emergency maintenance"
}
         ↓
All job dispatching stopped
         ↓
Extension still sends heartbeats
Extension polls for jobs → Returns empty
         ↓
Queued jobs wait in database
         ↓
When kill switch deactivated:
  ├─ Job dispatching resumes
  └─ Queued jobs processed
```

**User Experience:**
- Requests can still be created
- Payment proofs can still be uploaded
- Validation still happens
- Jobs created but not dispatched
- Status shows: "Processing..." (waiting)

**Operator Dashboard:**
```
⚠️  KILL SWITCH ACTIVE
━━━━━━━━━━━━━━━━━━━━━━━━
Reason: Emergency maintenance
Activated: Jan 18, 3:00 PM
By: admin@example.com

Queued Jobs: 15
[Deactivate Kill Switch]
```

### 7. Panel UI Changed (Selectors Broken)

**Flow:**
```
Extension executes job
         ↓
Step: search_for_user
         ↓
Try to find search input: SELECTORS.USER_SEARCH_INPUT
         ↓
❌ Element not found (timeout after 10s)
         ↓
Error with context:
"Failed at search_for_user (selector=\"#filter-input\"): Elemento no encontrado: #filter-input"
         ↓
Screenshot captured
         ↓
Job failed
         ↓
Operator reviews screenshot
         ↓
Operator sees: Panel UI changed
         ↓
Developer updates selectors in extension
         ↓
Extension updated and jobs resume
```

**Mitigation:**
- Regular testing on staging panel
- Alerts when job failure rate increases
- Quick selector updates

---

## System States & Transitions

### Request Status Flow

```
PENDING_PROOF
    ↓ (user uploads proof)
VALIDATING
    ↓
    ├─ ✅ Valid (confidence ≥ 0.8) → APPROVED
    │                                    ↓
    │                                 (job created)
    │                                    ↓
    │                              PROCESSING
    │                                    ↓
    │                              ┌────┴────┐
    │                              ✅        ❌
    │                          COMPLETED   FAILED
    │
    ├─ ❌ Invalid (confidence < 0.8) → VALIDATION_FAILED
    │                                        ↓
    │                                (operator reviews)
    │                                        ↓
    │                                   ┌────┴────┐
    │                                   ✅        ❌
    │                               APPROVED   REJECTED
    │                                   ↓
    │                            (job created)
    │                                   ↓
    │                             PROCESSING
    │                                   ↓
    │                              ┌────┴────┐
    │                              ✅        ❌
    │                          COMPLETED   FAILED
    │
    └─ ⚠️  Validator offline → VALIDATION_FAILED
                                       ↓
                               (manual review)
```

### Job Status Flow

```
QUEUED
    ↓ (bot receives job)
PROCESSING
    ↓
    ├─ ✅ Success → COMPLETED
    │                  ↓
    │          (balance updated)
    │
    └─ ❌ Failure → FAILED
                       ↓
                (operator review)
```

### Withdrawal Status Flow

```
PENDING
    ↓ (operator reviews)
    ├─ ✅ Approved → APPROVED
    │                   ↓
    │          (balance deducted)
    │
    └─ ❌ Rejected → REJECTED
                        ↓
                 (balance unchanged)
```

---

## Security & Safety Checks

### Request Creation Checks

✅ **User Authentication** - JWT token validated
✅ **Rate Limiting** - Max requests per hour (configurable)
✅ **Amount Validation** - Amount ≤ MAX_REQUEST_AMOUNT
✅ **Pending Limit** - Max 3 pending requests per user
✅ **Username Validation** - User must have username configured

### Proof Upload Checks

✅ **File Type Validation** - Only image/* or application/pdf
✅ **File Size Limit** - Max 10MB
✅ **Duplicate Detection** - SHA-256 hash checked against database
✅ **User Authorization** - Can only upload to own requests

### Job Dispatch Checks

✅ **Kill Switch** - Check if emergency stop active
✅ **Activity Window** - Check if within allowed hours
✅ **Cooldown** - 30 seconds between jobs
✅ **One Job at a Time** - No parallel execution
✅ **Bot Health** - Extension bot heartbeat within 2 minutes

### Operator Action Checks

✅ **Role-Based Access** - Only SENIOR_OPERATOR and ADMIN can approve
✅ **Request Status** - Only VALIDATION_FAILED or VALIDATING can be approved
✅ **Audit Logging** - All actions logged with operator ID and timestamp
✅ **Withdrawal Authorization** - Only approved operators can process

### Balance Transaction Safety

✅ **Atomic Transactions** - All balance changes in database transaction
✅ **Duplicate Check** - Verify transaction doesn't already exist
✅ **Balance Validation** - Check sufficient balance before withdrawal
✅ **Transaction Records** - Every change creates immutable transaction record

---

## Real-Time Notifications

### WebSocket Events

#### User Events (Chat App)

| Event | Trigger | Payload |
|-------|---------|---------|
| `request_created` | Request created | `{ requestId, status }` |
| `validation_started` | Proof uploaded | `{ requestId, status: 'VALIDATING' }` |
| `validation_completed` | AI approved | `{ requestId, status: 'APPROVED', score }` |
| `validation_failed` | AI rejected | `{ requestId, status: 'VALIDATION_FAILED', error }` |
| `request_updated` | Status changed | `{ requestId, status, reason? }` |
| `job_started` | Bot starts | `{ jobId, requestId }` |
| `job_progress` | Bot progress | `{ jobId, step, progress }` |
| `job_completed` | Job done | `{ jobId, requestId, amount }` |
| `job_failed` | Job error | `{ jobId, requestId, error }` |
| `withdrawal_approved` | Withdrawal paid | `{ withdrawalId, amount, newBalance }` |
| `withdrawal_rejected` | Withdrawal denied | `{ withdrawalId, reason }` |

#### Operator Events (Operator Panel)

| Event | Trigger | Payload |
|-------|---------|---------|
| `dashboard_update` | Any status change | `{}` (triggers refresh) |
| `new_failure` | Validation failed | `{ requestId, reason }` |
| `job_started` | Bot starts | `{ jobId, requestId, targetUsername, amount }` |
| `job_failed` | Job error | `{ jobId, error, screenshot }` |
| `bot_status_changed` | Bot online/offline | `{ status, lastHeartbeat }` |
| `validator_status_changed` | Validator connected/disconnected | `{ connected, validatorId }` |

### Push Notifications (Chat App)

**Success Notifications:**
- ✅ "Payment verified! Processing credits..."
- ✅ "Credits loaded successfully! $5,000 added"
- ✅ "Withdrawal approved! $2,000 paid"

**Warning Notifications:**
- ⚠️  "Your proof is under manual review"
- ⚠️  "Processing delayed - will complete shortly"

**Error Notifications:**
- ❌ "Request rejected: Invalid payment proof"
- ❌ "Withdrawal rejected: Insufficient balance"

---

## Summary

### Complete Flow in One Diagram

```
┌────────────┐
│    USER    │ (Chat App)
└──────┬─────┘
       │ 1. Create request + Upload proof
       ↓
┌─────────────────────────┐
│  BACKEND API (NestJS)   │
│  • Validate request     │
│  • Store proof          │
│  • Trigger validation   │
└──────────┬──────────────┘
           │ 2. Send proof for validation
           ↓
    ┌──────────────┐
    │ VALIDATOR    │ (Electron + Ollama AI)
    │ • Check amount│
    │ • Check date  │
    │ • Check auth  │
    └──────┬───────┘
           │ 3. Return result (valid/invalid)
           ↓
┌─────────────────────────┐
│  BACKEND API            │
│  • Process result       │
│  • Auto-approve if ≥0.8│
│  • Create job if valid │
└──────────┬──────────────┘
           │ 4. Dispatch job
           ↓
    ┌──────────────┐
    │ EXTENSION    │ (Chrome Extension)
    │ • Validate   │
    │   session    │
    │ • Search user│
    │ • Add credits│
    │ • Confirm    │
    └──────┬───────┘
           │ 5. Report success
           ↓
┌─────────────────────────┐
│  BACKEND API            │
│  • Update job status    │
│  • Add balance          │
│  • Create transaction   │
│  • Notify user          │
└──────────┬──────────────┘
           │ 6. Real-time event
           ↓
┌────────────┐
│    USER    │
│  ✅ Done!  │
└────────────┘
```

### Key Metrics

**Automatic Flow (Happy Path):**
- Success rate: 80-90% (high confidence validations)
- Time to completion: 3-5 minutes
- User touches: 2 (create request, upload proof)
- Operator touches: 0

**Manual Review Flow:**
- Occurrence: 10-20% of requests
- Time to completion: Depends on operator availability
- User touches: 2 (create request, upload proof)
- Operator touches: 1 (approve/reject)

**System Reliability:**
- Bot uptime target: 99%
- Validator uptime target: 95%
- Job success rate: 95%+ (with session validation)
- Balance accuracy: 100% (atomic transactions)

---

**Document Version:** 1.0
**Last Reviewed:** January 18, 2026
**Next Review:** February 1, 2026
