# Outbound Payments Architecture

## Overview

Automated outbound payment system for prize payouts and withdrawals. Uses dedicated Chrome extensions to execute real bank transfers via MercadoPago, Fiwind, Ripio, and Prex.

**Key Decision**: Payment extensions are SEPARATE from verification extensions. Verification extensions stay on the activities page 24/7 watching for incoming transfers (MutationObserver). Payment extensions navigate to the transfer flow, execute the payment, and capture the receipt. Both run in the same Chrome profile (shared session) but don't compete.

---

## System Architecture

```
                     BACKEND API
                         |
          +--------------+--------------+
          |              |              |
    Prize Claims    Outbound        Payment Bot
    Service         Payments        Gateway
    (triggers)      Service         (/payment-bot ns)
                    (orchestrates)       |
                         |          WebSocket
                    Job Queue       + Polling
                    (Postgres)          |
                         |     +-------+-------+-------+
                         |     |       |       |       |
                         +---> MP    Fiwind  Ripio   Prex
                              Payment Payment Payment Payment
                              Ext     Ext     Ext     Ext
                              (Chrome)(Chrome)(Chrome)(Chrome)
```

## Data Flow

### Happy Path: Prize Payout

```
1. User claims prize in Chat App
   → PrizeClaim created (PENDING_PAYMENT_DETAILS)

2. User provides CBU/alias in Chat App
   → PrizeClaim updated with payment details

3. Automation Extension verifies chips on gaming panel
   → PrizeClaim status: VERIFIED

4. Operator triggers chip withdrawal (or auto)
   → Job WITHDRAW_CHIPS created → Extension removes chips
   → PrizeClaim status: CHIPS_WITHDRAWN

5. Backend auto-creates OutboundPayment
   ├─ If AUTO_PAYMENT_REQUIRES_CONFIRM = true:
   │   → OutboundPayment status: PENDING
   │   → Operator sees "Confirmar Pago" button
   │   → Operator clicks confirm
   │   → OutboundPayment status: CONFIRMED → QUEUED
   └─ If AUTO_PAYMENT_REQUIRES_CONFIRM = false:
       → OutboundPayment status: CONFIRMED → QUEUED (auto)

6. Job dispatched to Payment Extension (matched by walletType)
   → OutboundPayment status: PROCESSING
   → Extension navigates to transfer flow
   → Fills destination (alias/CBU), amount
   → Confirms transfer
   → Captures screenshot of receipt
   → Extracts operation number

7. Extension reports success to backend
   → OutboundPayment status: COMPLETED
   → PrizeClaim status: COMPLETED
   → User notified: "Tu premio fue pagado! Nro: XXXX"
   → Screenshot stored in Cloudinary
```

### Failure Path

```
Extension fails at any step:
  → Screenshots current page
  → Reports error to backend
  → OutboundPayment status: FAILED
  → Operator alerted via WebSocket + Telegram
  → NO automatic retry (Golden Rule #4)
  → Operator can: retry manually or pay outside system
```

---

## Payment Extensions

### Structure (same for all 4)

```
apps/[platform]-payment-extension/
  manifest.json
  background/
    service-worker.js      # WebSocket/polling, job reception
    payment-processor.js   # Transfer flow orchestration
    api-client.js          # Backend HTTP communication
  content/
    transfer-automation.js # DOM automation for transfer flow
    humanize.js            # Human-like delays (copied from automation-extension)
  popup/
    popup.html / popup.js / popup.css
  options/
    options.html / options.js / options.css
  icons/
```

### Service Worker Responsibilities

- Connect to backend WebSocket (`/payment-bot` namespace)
- Authenticate with `paymentApiKey` (separate from bot API key)
- Receive `new_payment_job` events
- Fallback to HTTP polling (`GET /payment-bot/jobs/next`)
- Execute ONE job at a time (FIFO queue)
- Report results via HTTP (`POST /payment-bot/jobs/:id/result`)
- Heartbeat every 30s
- Screenshot on error (`chrome.tabs.captureVisibleTab`)

### Payment Processor Responsibilities

- Open platform tab (or reuse existing)
- Check login status before execution
- Navigate to transfer page
- Fill form fields with humanized delays
- Verify amounts before confirming
- Capture receipt after success
- Extract operation number from receipt
- Report back to service worker

### Content Scripts: Transfer Automation

Each platform has different DOM structure. Content scripts handle:

**Fiwind** (`panel.fiwind.io`):
```
Step 1: Navigate to /dashboard/withdrawal/fiat
Step 2: mat-select currency → ARS
Step 3: Input alias/CVU → mat-form-field input
Step 4: Input amount → mat-form-field input  
Step 5: Click "Continuar" → mat-raised-button
Step 6: Verify preview data matches job data
Step 7: Click "Confirmar Transferencia" → mat-raised-button
Step 8: Wait for receipt (app-success-movement-dialog)
Step 9: Extract operation number + capture screenshot
```

**Ripio** (`app.ripio.com`):
```
Step 1: Navigate to send money flow
Step 2: Select currency ARS → data-testid selector
Step 3: Select bank/network
Step 4: Input amount
Step 5: Input alias/CBU
Step 6: Verify preview
Step 7: Click confirm → data-testid button
Step 8: Wait for receipt
Step 9: Extract operation number + screenshot
```

**MercadoPago** (`mercadopago.com.ar`):
```
Step 1: Navigate to /transfer
Step 2: Input alias/CBU → search input
Step 3: Select recipient
Step 4: Input amount
Step 5: Click "Transferir"
Step 6: Wait for confirmation page
Step 7: Extract operation number + screenshot
```

**Prex** (`app.prexcard.com.ar`):
```
Step 1: Navigate to transfers section
Step 2: Select destination type (CBU/alias)
Step 3: Input destination
Step 4: Input amount
Step 5: Confirm transfer
Step 6: Wait for receipt
Step 7: Extract operation number + screenshot
```

---

## Backend Module: OutboundPayments

### New Files

```
apps/backend-api/src/
  outbound-payments/
    outbound-payments.module.ts
    outbound-payments.service.ts
    outbound-payments.controller.ts
    payment-bot.gateway.ts          # WebSocket /payment-bot namespace
    dto/
      create-outbound-payment.dto.ts
      confirm-outbound-payment.dto.ts
      payment-result.dto.ts
```

### Database Model

```prisma
model OutboundPayment {
  id                String                @id @default(uuid())
  type              OutboundPaymentType
  status            OutboundPaymentStatus @default(PENDING)
  
  // Source (one of these is set)
  prizeClaimId      String?               @unique
  withdrawalId      String?               @unique
  userId            String
  
  // What to pay
  amount            Decimal               @db.Decimal(10, 2)
  paymentMethod     String                // "CBU" | "ALIAS"
  paymentDetails    Json                  // { cbu?, alias?, accountHolder }
  
  // Which wallet pays
  walletId          String
  walletType        String                // MERCADOPAGO, FIWIND, RIPIO, PREX
  
  // Execution tracking
  jobId             String?               @unique
  operationNumber   String?               // From receipt
  screenshotUrl     String?
  error             String?
  attempts          Int                   @default(0)
  
  // Approval
  requiresConfirm   Boolean              @default(true)
  confirmedBy       String?
  confirmedAt       DateTime?
  
  // Timestamps
  createdAt         DateTime              @default(now())
  executedAt        DateTime?
  completedAt       DateTime?
  
  @@index([status])
  @@index([walletId])
  @@index([userId])
}
```

### Status Flow

```
PENDING ──────────→ CONFIRMED ──→ QUEUED ──→ PROCESSING ──→ COMPLETED
  │                    │                         │
  ├─→ CANCELLED        ├─→ CANCELLED            └─→ FAILED
  │   (operator)       │   (operator)                 │
  │                    │                              └─→ (operator retries
  └─→ CONFIRMED       └─→ QUEUED                          or pays manually)
      (auto, if no
       confirm needed)
```

### Service Methods

```typescript
// Triggered by prize-claims.service after CHIPS_WITHDRAWN
createFromPrizeClaim(claimId: string)

// Triggered by withdrawals.service after APPROVED (future)
createFromWithdrawal(withdrawalId: string)

// Operator confirms payment
confirm(paymentId: string, operatorId: string)

// Cancel pending payment
cancel(paymentId: string, operatorId: string, reason: string)

// Payment extension reports result
handlePaymentResult(jobId: string, dto: PaymentResultDto)

// Manual retry after failure
retry(paymentId: string, operatorId: string)

// Get pending payments for operator dashboard
findPending(): OutboundPayment[]
findByStatus(status: OutboundPaymentStatus): OutboundPayment[]
```

### WebSocket Gateway (`/payment-bot`)

```typescript
// Extension → Backend
'payment_result'    // { jobId, success, operationNumber?, screenshot?, error? }
'heartbeat'         // { timestamp, panelId }
'balance_report'    // { walletType, balance }

// Backend → Extension
'new_payment_job'   // { id, type, amount, paymentMethod, paymentDetails, walletType }
'cancel_job'        // { jobId }
'kill_switch'       // Emergency stop
```

---

## Wallet Configuration

### New Fields on PaymentConfig

```prisma
// Add to existing PaymentConfig model:
outboundEnabled     Boolean   @default(false)  // Can this wallet pay prizes?
outboundBalance     Decimal?  @db.Decimal(10, 2) // Reported by extension
lastBalanceCheck    DateTime?
```

### Wallet Selection for Payments

1. Query wallets where `outboundEnabled = true` AND `type = preferredType`
2. Filter by `outboundBalance >= paymentAmount` (if balance known)
3. If multiple match: pick one with highest balance
4. If none match: try other wallet types with `outboundEnabled = true`
5. If still none: emit `no_wallet_available` alert to operators

---

## Crypto Buy (Fiwind Only)

### Auto-Buy Flow

```
Fiwind wallet ARS balance > CRYPTO_AUTO_BUY_THRESHOLD
  → Backend creates Job (type: BUY_CRYPTO)
  → Fiwind Payment Extension receives job
  → Navigates to Convertir Cripto
  → Selects "Comprar" USDT
  → Enters ARS amount
  → Previews conversion rate
  → Confirms purchase
  → Captures receipt
  → Reports result to backend
```

### Manual Buy (Operator Panel)

- Operator clicks "Comprar Cripto" in wallet view
- Enters ARS amount
- Backend creates BUY_CRYPTO job
- Same extension flow as auto

### Settings

```
CRYPTO_AUTO_BUY_ENABLED       boolean   (default: false)
CRYPTO_AUTO_BUY_THRESHOLD     number    (default: 100000)  // ARS
CRYPTO_AUTO_BUY_WALLET_ID     string    (Fiwind wallet ID)
```

---

## Settings Summary

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| AUTO_PAYMENT_ENABLED | boolean | false | Enable automatic prize payouts |
| AUTO_PAYMENT_REQUIRES_CONFIRM | boolean | true | Operator must confirm each payment |
| AUTO_PAYMENT_MAX_AMOUNT | number | 50000 | Max amount per auto-payment (ARS) |
| OUTBOUND_PAYMENT_WALLET_ID | string | '' | Preferred wallet for outbound payments |
| CRYPTO_AUTO_BUY_ENABLED | boolean | false | Auto-convert ARS to USDT on Fiwind |
| CRYPTO_AUTO_BUY_THRESHOLD | number | 100000 | ARS threshold to trigger auto-buy |
| CRYPTO_AUTO_BUY_WALLET_ID | string | '' | Fiwind wallet for crypto operations |

All settings configurable from Operator Panel + Operator Mobile.

---

## Security Considerations

### Golden Rules (same as automation-extension)
1. **Humanized delays**: 2-7s between actions, character-by-character typing
2. **One at a time**: Single payment job per extension
3. **No auto-retry**: Fail and stop, operator reviews
4. **Screenshot everything**: Capture receipt on success, capture page on error
5. **Pre-flight checks**: Verify balance before attempting transfer

### Additional Security
- **Amount verification**: Extension verifies the amount shown in confirmation matches job amount before clicking confirm
- **Recipient verification**: Extension verifies destination alias/CBU matches job data
- **Double-payment prevention**: Backend enforces unique constraint on `prizeClaimId`/`withdrawalId` in OutboundPayment
- **Balance tracking**: Extension reports wallet balance periodically; backend blocks payments if insufficient
- **Operator audit trail**: Every confirm/cancel/retry logged with operator ID and timestamp
- **Kill switch**: Global kill switch stops all payment extensions immediately

---

## Implementation Phases

### Phase 1: Backend Foundation
- Prisma schema migration
- OutboundPayments service + controller + DTOs
- PaymentBot WebSocket gateway
- Integration with prize-claims (auto-create on CHIPS_WITHDRAWN)
- New settings in settings service + DTO
- Wallet outbound fields

### Phase 2: Fiwind Payment Extension (reference implementation)
- Extension scaffold (manifest, structure)
- Transfer automation content scripts
- Crypto buy content scripts
- Service worker + payment processor
- Manual E2E testing

### Phase 3: Remaining Extensions
- MP, Ripio, Prex payment extensions
- Platform-specific content scripts

### Phase 4: Operator UI
- Desktop panel: payments view, confirm/retry, crypto buy button
- Mobile: payments tab, settings
- Chat app: payment notification to user
