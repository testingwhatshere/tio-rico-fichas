# 🧠 Automation Bot Master Manual

### External Gaming Panel Credit Loader

---

## 1. Purpose of This Document

This document defines the **technical, operational, and behavioral rules** for an automation system that loads credits/points into user accounts on an **external gaming platform**, triggered by a chat application.

The goal is to:

* Reduce manual workload
* Minimize human error
* Operate discreetly
* Avoid detection, bans, or account suspension

This is **not** an enterprise API integration.
This is a **controlled, human-like automation**.

---

## 2. High-Level System Overview

### Business Flow

1. User requests credit load via chat
2. Payment is validated by backend
3. Backend identifies:

   * Target username
   * Amount to load
4. A bot executes the load from the gaming panel
5. Result is logged and confirmed

---

## 3. Technology Stack (Recommended)

### Core Automation

* **Playwright (Node.js)**

  * Chromium browser
  * Headful mode (NOT headless)
  * Persistent browser context

### Backend

* Node.js (Express / Fastify / Nest)
* Job queue (BullMQ / simple FIFO queue)
* Database (PostgreSQL / MySQL / SQLite)

### Infrastructure

* Dedicated VPS or server
* Static IP (very important)
* Linux environment (Ubuntu preferred)

### Optional

* PM2 for process management
* Cron for scheduled health checks
* Centralized logging (simple files are enough)

---

## 4. Non-Negotiable Golden Rules

⚠️ **Breaking any of these rules dramatically increases ban risk**

### Rule 1 — Never Look Like a Bot

* ❌ No headless mode
* ❌ No instant actions
* ❌ No repetitive fixed delays

✔️ Always behave slower than a human

---

### Rule 2 — One Action at a Time

* **ONLY ONE credit load at once**
* No parallel jobs
* No batch processing

This system must feel like:

> “One admin using the panel normally”

---

### Rule 3 — Session Persistence

* Login once
* Save cookies + localStorage
* Reuse the same session indefinitely

Frequent logins = red flag.

---

### Rule 4 — Never Retry Automatically

If something fails:

* Stop
* Log the error
* Require manual review

Auto-retries create suspicious patterns.

---

### Rule 5 — Do Not Scale Aggressively

* No mass loads
* No spikes
* No sudden traffic increases

This automation must **age slowly and naturally**.

---

## 5. Cloudflare & Anti-Bot Strategy

### Allowed Assumptions

* Cloudflare protection is basic
* JS challenge / checkbox level
* No advanced fingerprinting

### Required Measures

* Real Chromium
* Real viewport
* Mouse movements
* Typing delays
* Natural navigation order

### Forbidden

* User-agent spoofing libraries
* CAPTCHA solvers
* Proxy rotation

If Cloudflare adds hard captchas → **automation stops**

---

## 6. Playwright Configuration Rules

### Browser

* Chromium
* Headful mode
* Fixed screen size (desktop)

### Interaction Style

* Type character by character
* Randomized delays (2–7 seconds)
* Mouse movement before clicks
* Wait for elements, not timeouts

### Timing Philosophy

> Slow is safe. Fast is suspicious.

---

## 7. Job Queue Rules

Each job must contain:

* Unique job ID
* Target username
* Credit amount
* Timestamp
* Status (pending / success / failed)

Queue behavior:

* FIFO only
* One worker only
* Cooldown between jobs

---

## 8. Logging & Auditing

Every operation must log:

* Date & time
* Username
* Amount
* Result
* Screenshot on error

Logs are **mandatory** for:

* Disputes
* Debugging
* Trust with client

---

## 9. What MUST NEVER Be Automated

🚫 Never automate:

* Password changes
* Security settings
* Email changes
* Admin role changes
* Bulk user operations

These actions are high-risk and unnecessary.

---

## 10. Failure Scenarios & Responses

### If the panel UI changes

* Pause automation
* Update selectors
* Resume only after validation

### If Cloudflare blocks access

* Stop immediately
* Do NOT bypass
* Switch to manual operation

### If account gets flagged

* Automation is permanently stopped
* No “workarounds”

---

## 11. Legal & Responsibility Boundary

This system:

* Uses legitimate credentials
* Acts on behalf of an authorized operator
* Does not scrape public data
* Does not exploit vulnerabilities

However:

* It operates without official API support
* It may violate platform TOS
* All parties accept operational risk

This must be **explicitly acknowledged**.

---

## 12. Project Philosophy (Very Important)

This automation is:

* Tactical
* Fragile by nature
* Meant to save time, not replace the platform

It is **not**:

* A long-term scalable fintech system
* A guaranteed permanent solution

---

## 13. Final Statement

> “This system works as long as it behaves like a careful human.”

The moment it behaves like software, it will be detected.

Respect the rules.
Move slowly.
Log everything.

---

**End of Manual**


# 💬 Client Chat App & Operator Panel

### Operational Control Layer

---

## 1. Purpose of This Layer

This layer sits **above** the automation bot and acts as the **human + business control system**.

Its goals are to:

* Allow users to request credit loads
* Allow operators to manage conversations
* Validate and approve operations
* Control when the bot is triggered
* Maintain accountability and logs

**The bot never acts directly on user input.**
All actions pass through operators or backend rules.

---

## 2. High-Level Architecture

```
Client App (Chat)
     ↓
Backend API
     ↓
Operator Panel
     ↓
Approval / Validation
     ↓
Job Queue
     ↓
Automation Bot
```

This guarantees:

* No direct bot abuse
* Human oversight
* Clear responsibility chain

---

## 3. Client Chat Application

### Core Features

* Real-time chat with operators
* User identification (username / ID)
* Payment intent submission
* Status notifications
* History of requests

### UX Principles

* Simple
* Familiar (WhatsApp-style)
* Clear system messages
* No technical exposure

### Platform Options

* Web App (PWA recommended)
* Mobile App (React Native / Expo)
* Embedded widget (optional)

---

## 4. Operator Panel (Control Center)

### Mandatory Features

#### 4.1 Conversation Management

* View all active chats
* Assign conversations to operators
* Transfer chats between operators
* Internal notes (not visible to users)

#### 4.2 Request Handling

Each credit request must display:

* Client identity
* Target gaming username
* Requested amount
* Payment status
* Risk flags (manual / auto)

Operators can:

* Approve
* Reject
* Hold for review

---

## 5. Operator Roles & Permissions

### Roles

* **Operator**

  * Chat
  * Create requests
  * Cannot trigger bot

* **Senior Operator**

  * Approve requests
  * Trigger bot jobs

* **Admin**

  * Full access
  * System settings
  * Emergency stops

### Principle

> No single person should control the full money → bot pipeline.

---

## 6. Backend Responsibilities

### Core Logic

* User identity mapping
* Payment validation
* Amount normalization
* Fraud prevention rules
* Rate limiting per user

### Safety Checks

* Max amount per request
* Max requests per hour
* Duplicate detection

If any rule fails → manual review.

---

## 7. Bot Trigger Rules

The bot may only be triggered when:

* Request is approved
* Payment is confirmed
* No active job is running
* Cooldown window is respected

### Forbidden

* Auto-trigger on user message
* Trigger without operator review
* Parallel executions

---

## 8. Operator UX Rules

Operators must:

* Confirm username spelling
* Confirm amount
* Verify panel availability
* Monitor bot execution

Operators must NOT:

* Rush approvals
* Bypass validation
* Retry failed jobs without review

---

## 9. Communication Between Layers

### Status Flow

* Pending → Approved → Processing → Completed / Failed

### Notifications

* Operators see live bot status
* Users receive simple updates:

  * “Processing”
  * “Completed”
  * “Please contact support”

No technical error details to users.

---

## 10. Logging & Transparency

Every action must be logged:

* Operator ID
* Action taken
* Timestamp
* Reason (optional)

This creates:

* Accountability
* Trust
* Debug traceability

---

## 11. Emergency Controls

### Global Kill Switch

* Stops bot execution
* Locks new requests
* Keeps chat active

### Manual Override

* Mark job as “manual processing”
* Disable automation temporarily

---

## 12. Scalability Strategy (Safe Scaling)

To scale safely:

* Add operators, not bot speed
* Increase cooldowns gradually
* Monitor patterns weekly

Never:

* Increase concurrency
* Remove approvals
* Hide logs

---

## 13. Security & Trust Principles

* Operators never see passwords
* Credentials stored encrypted
* Bot runs in isolated environment
* No shared admin access

---

## 14. Final Philosophy

> The chat system absorbs chaos.
> The operator panel absorbs risk.
> The bot executes calmly.

This separation is what keeps the system alive.

---

**End of Document**
