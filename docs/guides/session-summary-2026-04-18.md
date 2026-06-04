# Session Summary — 18-19 Abril 2026

## What Was Done

### 1. Full Codebase Audit (7 rounds, 39 bugfixes)

Audited ALL apps in the monorepo and fixed 39 bugs across 27 files:

**Security/Financial (Critical):**
- Same-user proof reuse prevention (duplicate credit exploit)
- AMOUNT_MISMATCH fraud detection (critical flag)
- Validation threshold minimum 0.5 (prevents bypass)
- MAX_REQUEST_AMOUNT configurable (default $50k)
- Operator approvedAmount cannot exceed original
- Cross-user sender check expanded to all active statuses
- MP verification amount comparison precision fix

**Backend Reliability:**
- Dashboard: PENDING_MP_VERIFICATION count
- Wallet accumulation: await + alert on failure
- Job creation: alert operators on failure
- Prize claims: atomic transaction for job+claim
- Telegram: lazy-reload chatIds
- Bot gateway: safe Map iteration (2 cases)
- Status transitions: cancel from VALIDATING/PENDING_MP_VERIFICATION

**Extensions:**
- Reconnect loop fix (wsReconnectExhausted) — MP, Fiwind, Prex, Ripio
- Humanize.js safe defaults before config
- reportJobStarted response validation
- processedJobIds Map with 1h TTL
- Selector validation expanded 13→23
- Zombie threshold 150s→120s
- Auto-detect wallet debounce
- selectors.js rewritten for Fiwind/Prex/Ripio (was copy-pasted MP)
- Verification processor URLs corrected from MHTMLs

**Chat App:** flushBuffer dedup, dead listener cleanup, wallet null guard, glow animation leak
**Operator Panel:** prompt sanitization hardened, settings UI for auto-payment
**Operator Mobile:** response validation, amountLimit NaN guard, outbound payment events
**Validator App:** atomic config write, EPIPE suppression
**Client Manager:** HTTPS enforcement for remote monitoring

### 2. Outbound Payments System (Complete Feature)

Automated prize payouts via Chrome extensions.

**Backend:**
- New Prisma model: `OutboundPayment` (7-state lifecycle)
- New module: `outbound-payments/` (service, controller, DTOs)
- `PaymentBotGateway` — WebSocket `/payment-bot` namespace
- `PaymentBotController` — HTTP polling fallback endpoints
- 7 new settings (auto-payment, crypto buy)
- Integration: auto-creates payment after CHIPS_WITHDRAWN
- Operator gateway: 4 socket handlers + 5 event listeners

**4 Payment Chrome Extensions:**
- `apps/fiwind-payment-extension/` — Transfers + USDT crypto buy
- `apps/mp-payment-extension/` — MercadoPago transfers
- `apps/ripio-payment-extension/` — Ripio transfers (data-testid selectors verified from MHTMLs)
- `apps/prex-payment-extension/` — Prex transfers (Bootstrap selectors)

**Operator Panel Integration:**
- "Pagos" sidebar view with confirm/cancel/retry
- IPC handlers, preload channels, socket listeners
- Auto-payment settings in system config UI

**Mobile + Chat App:**
- Operator mobile: socket listeners, store, settings toggles
- Chat app: `prize_claim:payment_sent` notification

**Documentation:** `docs/guides/outbound-payments-architecture.md`

### 3. OCR Fast-Path in Validator App

Tesseract.js OCR for fast validation (2-15s vs 20-120s Ollama).

**Architecture:**
- OCR runs first → if confidence >=70% and amount matches → fast-path
- If OCR fails → falls back to Ollama vision
- Both sandbox and production use same pipeline

**Image Preprocessing (Sharp):**
- Resize to 1200px, grayscale, normalize contrast, sharpen, binarize
- 3 variants: standard (PSM 6), high-contrast (PSM 11), inverted
- Multi-pass: runs all variants, picks best, merges missing fields

**OCR Digit Normalization:**
- Handles Tesseract reading O as 0, I as 1 in CVU/CBU/CUIT

**Pattern Registry (30 banks/wallets):**
```
ocr/patterns/
  index.js          — Auto-detection registry
  _helpers.js       — Shared extraction functions
  mercadopago.js    — Detailed (tested with real receipts)
  generic.js        — Fallback for unknown platforms
  + 28 boilerplates (Galicia, Santander, BBVA, Brubank, Ualá, etc.)
```

Each pattern exports `detect(text)` and `extract(text)`.
Auto-detection: tries each pattern in order, first match wins.

**OCR Sandbox (Validator App tab):**
- Upload image/PDF, see raw text, see extracted fields
- Platform auto-detection displayed
- 10 fields: monto, fecha, estado, sender, CUIT, destinatario, cuenta dest., banco, operación, método
- Expected amount comparison (match/mismatch indicator)
- Ollama comparison button (side-by-side with timing)
- Test history with method, platform, confidence, duration
- Copy raw text, save/export/import examples

### 4. Validator App Refactoring

Split 2903-line `main.js` into 11 focused modules:

```
main.js (230 lines)     — App lifecycle, window, tray
config.js               — Config/path management
ocr/worker.js           — Tesseract worker + multi-pass
ocr/parser.js           — Pattern registry integration
ocr/preprocess.js       — Sharp image preprocessing
ocr/examples.js         — Training examples persistence
ocr/patterns/           — 30+ bank pattern files
validation/ollama.js    — Ollama inference + prompts
validation/pipeline.js  — OCR→Ollama routing
socket/connection.js    — Socket.IO management
socket/queue.js         — Offline + validation queues
ollama/manager.js       — Ollama install/health
ipc/handlers.js         — All 26 IPC handlers
```

## Commits (in order)

1. `658da3f` — 39 bugfixes + OCR fast-path + security hardening
2. `3918fa9` — Outbound payments system (4 extensions + backend)
3. `974c05d` — Wire outbound payments across all apps
4. `e61ef8a` — OCR Sandbox tab
5. `f367504` — HTTP endpoints, settings UI, selector fixes, compilation
6. `9ac606d` — Fix validator startup crash (lazy ocrExamplesPath)
7. `9a0c510` — Fix OCR worker infinite loop
8. `6a976ff` — Suppress EPIPE errors
9. `97980f9` — Fix amount patterns for integers ($500)
10. `d6db3f1` — Improve patterns for MP receipts (status, bank, operation)
11. `a85c919` — Amount extraction fallbacks
12. `590b54b` — Refactor validator: 2903→230 lines main.js
13. `ba91587` — Pattern registry: 30 banks/wallets
14. `6d594e9` — Add recipientName/Account to all patterns
15. `1e1dfb6` — Sandbox improvements (platform, history, Ollama comparison)
16. `4ae1519` — Fix IPC handler dependencies
17. `51047cf` — Fix validateConfig + config reference
18. `37db418` — Sharp preprocessing + multi-pass OCR
19. `288c9c2` — OCR digit normalization (O→0)
20. `62344fe` — MP recipient CVU extraction fix

## What's Next

### OCR Training
- Test with comprobantes from ALL 30 banks/wallets
- Adjust patterns per platform using the sandbox
- Each bank has a boilerplate in `ocr/patterns/` ready to customize

### Payment Extensions
- Test transfer selectors in real browser (Fiwind, MP, Ripio, Prex)
- Adjust DOM selectors for actual transfer flow pages
- End-to-end test: prize claim → chips withdrawn → auto-payment → completed

### Remaining System Pieces
- Run Prisma migration (`npx prisma migrate dev`)
- Test backend compilation (`npx tsc --noEmit` — was 0 errors)
- Test full validation flow with backend connected
- Operator panel: test payments view
