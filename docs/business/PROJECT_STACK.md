# 🏗️ Full System Stack & Project Scaffolding

### Chat App · Operator Panel · Automation Bot

---

## 1. System Components Overview

The system is intentionally split into **4 independent but connected parts**:

1. Client Chat App (users)
2. Operator Panel (internal staff)
3. Backend API (business logic + control)
4. Automation Bot (Playwright)

Each part has **clear responsibility boundaries**.

---

## 2. Stack Selection (What & Why)

### 2.1 Client Chat Application

#### Recommended Stack

* **Frontend**: React Native (Expo)
* **Alternative**: Web PWA (Next.js)
* **Realtime**: WebSockets (Socket.IO)
* **Auth**: JWT (issued by backend)

#### Why

* Mobile-first users
* WhatsApp-like UX
* Expo = fast iteration + OTA updates
* Shared logic with operator panel (TypeScript)

---

### 2.2 Operator Panel

#### Recommended Stack

* **Frontend**: Next.js (App Router)
* **UI**: Tailwind + shadcn/ui
* **State**: React Query / TanStack Query
* **Auth**: Role-based JWT

#### Why

* Fast internal dashboards
* Excellent table + admin UX
* Easy permission handling
* SSR not required, but nice

---

### 2.3 Backend API (The Brain)

#### Recommended Stack

* **Runtime**: Node.js
* **Framework**: NestJS
* **Language**: TypeScript
* **DB**: PostgreSQL
* **ORM**: Prisma
* **Queue**: BullMQ (Redis)
* **Realtime**: Socket.IO

#### Why

* NestJS enforces structure (important here)
* Prisma = safe migrations
* BullMQ = reliable job control
* Redis = rate limits + locks

This backend is the **single source of truth**.

---

### 2.4 Automation Bot

#### Recommended Stack

* **Runtime**: Node.js
* **Automation**: Playwright
* **Execution**: Headful Chromium
* **Process Manager**: PM2

#### Why

* Same language as backend
* Easy sharing of types
* Playwright > Selenium
* PM2 handles crashes cleanly

---

## 3. Monorepo vs Polyrepo

### ✅ Recommended: **Monorepo**

Use:

* **pnpm workspaces** or **Turborepo**

Benefits:

* Shared types
* Shared validation schemas
* One CI pipeline
* Less glue code

---

## 4. Monorepo Folder Structure

```
/project-root
│
├── apps/
│   ├── chat-app/           # Expo / React Native
│   ├── operator-panel/     # Next.js
│   ├── backend-api/        # NestJS
│   └── automation-bot/     # Playwright
│
├── packages/
│   ├── shared-types/       # DTOs, enums
│   ├── shared-utils/       # Validation, helpers
│   └── shared-config/      # Env schemas
│
├── infra/
│   ├── docker/
│   ├── nginx/
│   └── scripts/
│
├── docs/
│   ├── master-bible.md
│   └── operator-sop.md
│
└── package.json
```

---

## 5. Backend API Scaffolding (NestJS)

### Core Modules

```
src/
├── auth/
├── users/
├── chats/
├── messages/
├── operators/
├── requests/
├── payments/
├── jobs/
├── bot/
├── logs/
└── health/
```

### Key Principles

* Controllers = thin
* Services = logic
* Guards = permissions
* Interceptors = logging

---

## 6. Job Queue Design

### Queue Rules

* Single worker
* FIFO only
* Lock per job
* Cooldown enforced

### Job Flow

```
REQUEST_APPROVED
   ↓
QUEUE_JOB_CREATED
   ↓
BOT_EXECUTES
   ↓
RESULT_LOGGED
```

---

## 7. Automation Bot Scaffolding

```
automation-bot/
├── src/
│   ├── browser/
│   │   ├── context.ts
│   │   └── session.ts
│   ├── flows/
│   │   ├── login.flow.ts
│   │   └── loadCredits.flow.ts
│   ├── selectors/
│   │   └── panel.selectors.ts
│   ├── utils/
│   │   ├── delays.ts
│   │   └── humanize.ts
│   ├── jobs/
│   │   └── processJob.ts
│   └── index.ts
│
├── storage/               # Cookies/session
├── screenshots/
└── logs/
```

### Absolute Rules

* No logic in selectors
* No retries
* One job at a time

---

## 8. Chat App Scaffolding (Expo)

```
chat-app/
├── app/
│   ├── auth/
│   ├── chat/
│   ├── requests/
│   └── profile/
│
├── services/
│   ├── api.ts
│   └── socket.ts
│
├── store/
│   └── auth.store.ts
└── ui/
```

---

## 9. Operator Panel Scaffolding (Next.js)

```
operator-panel/
├── app/
│   ├── login/
│   ├── dashboard/
│   ├── chats/
│   ├── requests/
│   ├── jobs/
│   ├── logs/
│   └── settings/
│
├── components/
├── hooks/
└── services/
```

---

## 10. Environment Separation

### Required Environments

* Local
* Staging
* Production

### Environment Rules

* Bot only runs in prod
* Feature flags for automation
* Kill switch in backend

---

## 11. Deployment Strategy

### Backend

* VPS + Docker
* PostgreSQL managed
* Redis managed

### Frontends

* Vercel (operator panel)
* Expo EAS (chat app)

### Bot

* Same VPS as backend
* Isolated user
* Static IP

---

## 12. Why This Architecture Works

* Clear separation of concerns
* Easy to pause automation
* Humans always in control
* Bot is replaceable
* Scales by people, not risk

---

## 13. Final Engineering Philosophy

> “Automate execution, not decisions.”

This stack enforces that philosophy **by design**.

---

**End of Document**
