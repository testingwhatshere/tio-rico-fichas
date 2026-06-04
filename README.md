# Tio Rico Fichas 🎰💰

**Automated Credit Loading Platform** - A comprehensive system for managing credit requests with AI-powered validation, operator supervision, and browser automation.

---

## 🚀 Quick Start

Get the entire system running in 5 minutes:

```bash
# 1. Clone and install dependencies
git clone <repo-url>
cd game-automation-platform
bun install

# 2. Run automated setup
./scripts/setup.sh

# 3. Start backend API (terminal 1)
cd apps/backend-api
bun run start:dev

# 4. Start chat app (terminal 2)
cd apps/chat-app
bun run start

# 5. Start operator panel (terminal 3)
cd apps/operator-panel
npm start
```

**Done!** 🎉 The system is now running locally.

**Default Credentials:**
- Admin: `admin@tiorico.com` / `admin123`
- Operator: `operator1@tiorico.com` / `operator123`
- Client: `juan123` / `client123`

---

## 📋 What Is This?

Tio Rico Fichas is a complete platform for managing credit loading requests with:

- 📱 **Mobile Chat App** - Users request credits via WhatsApp-style chat
- 🤖 **AI Validation** - Automatic payment proof verification using Ollama
- 👨‍💼 **Operator Panel** - Desktop app for manual review and approval
- 🔄 **Browser Automation** - Chrome extension executes credit loads
- 🏗️ **Backend API** - NestJS server orchestrating everything
- 🌐 **Landing Page** - APK distribution website

**Core Philosophy:** "Almost fully automated, humans supervise failures"

---

## 🏗️ System Architecture

```
┌─────────────┐       ┌──────────────┐       ┌──────────────┐
│  Chat App   │──────▶│ Backend API  │──────▶│  Validator   │
│  (Mobile)   │       │  (NestJS)    │       │  App (AI)    │
└─────────────┘       └──────────────┘       └──────────────┘
                              │
                    ┌─────────┼─────────┐
                    ▼                   ▼
            ┌───────────────┐   ┌──────────────┐
            │   Operator    │   │  Automation  │
            │  Panel (UI)   │   │  Extension   │
            └───────────────┘   └──────────────┘
```

### 📦 Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Backend API** | NestJS + Prisma | Core business logic, REST API, WebSocket server |
| **Chat App** | Expo (React Native) | Mobile app for end users to request credits |
| **Operator Panel** | Electron | Desktop app for operators to review failures |
| **Validator App** | Electron + Ollama | AI-powered payment proof validation |
| **Automation Extension** | Chrome Extension | Credit loading automation in real browser |
| **Landing Page** | Static HTML | APK distribution website |

### 🗄️ Infrastructure

| Service | Technology | Purpose |
|---------|-----------|---------|
| **Database** | PostgreSQL 16 | Persistent data storage |
| **Cache/Queue** | Redis 7 | Job queue (BullMQ) and caching |
| **AI Model** | Ollama (llama3.2-vision) | OCR/validation of payment proofs |

---

## 📁 Project Structure

```
game-automation-platform/
├── apps/
│   ├── backend-api/          # NestJS backend
│   ├── chat-app/              # Expo mobile app
│   ├── operator-panel/        # Electron desktop app
│   ├── validator-app/         # Electron AI validator
│   ├── automation-extension/  # Chrome extension
│   └── landing-page/          # Static website
├── packages/                  # (Future: shared code)
├── scripts/
│   ├── setup.sh               # Automated setup
│   ├── health-check.sh        # System health verification
│   └── build-all.sh           # Build all apps
├── docker-compose.yml         # Local dev infrastructure
├── DEPLOYMENT.md              # 📖 Complete deployment guide
├── CLAUDE.md                  # 🧠 Project memory & architecture
└── README.md                  # 👈 You are here
```

---

## 🛠️ Prerequisites

- **Node.js** 18+ ([Download](https://nodejs.org/))
- **Bun** (recommended) or npm ([Install](https://bun.sh/))
- **Docker Desktop** ([Download](https://www.docker.com/products/docker-desktop/))
- **Git**

**Optional:**
- **Ollama** (for AI validation) ([Install](https://ollama.com/))

### Check Versions:

```bash
node --version  # v18+
bun --version   # 1.0+
docker --version  # 20+
```

---

## 📚 Documentation

| Document | Description |
|----------|-------------|
| **[DEPLOYMENT.md](./DEPLOYMENT.md)** | Complete deployment guide (local, staging, production) |
| **[CLAUDE.md](./CLAUDE.md)** | Project architecture, philosophy, and technical details |
| **[apps/backend-api/README.md](./apps/backend-api/README.md)** | Backend API documentation |
| **[apps/chat-app/README.md](./apps/chat-app/README.md)** | Mobile app setup and development |
| **[apps/landing-page/README.md](./apps/landing-page/README.md)** | Landing page deployment |

---

## 🚦 Getting Started

### 1. Install Dependencies

```bash
bun install
```

### 2. Start Infrastructure

```bash
# Start PostgreSQL and Redis
docker-compose up -d postgres redis
```

### 3. Configure Environment

```bash
# Backend API
cp apps/backend-api/.env.example apps/backend-api/.env
vi apps/backend-api/.env  # Update as needed

# Chat App
cp apps/chat-app/.env.example apps/chat-app/.env
vi apps/chat-app/.env
```

### 4. Setup Database

```bash
cd apps/backend-api

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate deploy

# Seed database (optional)
npm run db:seed
```

### 5. Start Applications

**Backend API:**
```bash
cd apps/backend-api
bun run start:dev
```

**Chat App:**
```bash
cd apps/chat-app
bun run start
```

**Operator Panel:**
```bash
cd apps/operator-panel
npm start
```

**Validator App (optional):**
```bash
cd apps/validator-app
npm start
```

---

## 🧪 Testing & Verification

### Run Health Checks

```bash
./scripts/health-check.sh
```

This verifies:
- ✅ Docker services (PostgreSQL, Redis)
- ✅ Backend API health
- ✅ Database schema
- ✅ API endpoints
- ✅ Redis queue

### Manual Testing

1. **Backend API**: Visit `http://localhost:3000/health`
2. **Prisma Studio**: `cd apps/backend-api && npx prisma studio`
3. **Redis Commander**: `docker-compose --profile tools up -d redis-commander`
4. **pgAdmin**: `docker-compose --profile tools up -d pgadmin`

---

## 🎯 Development Workflow

### Day-to-Day Development

```bash
# Start infrastructure (once)
docker-compose up -d postgres redis

# Start backend (terminal 1)
cd apps/backend-api && bun run start:dev

# Start chat app (terminal 2)
cd apps/chat-app && bun run start

# Start operator panel (terminal 3)
cd apps/operator-panel && npm start

# View logs
docker-compose logs -f
```

### Database Changes

```bash
cd apps/backend-api

# Create migration
npx prisma migrate dev --name migration_name

# View database
npx prisma studio
```

### Build for Production

```bash
# Backend
cd apps/backend-api && npm run build

# Chat App APK
cd apps/chat-app && eas build --platform android

# Operator Panel installer
cd apps/operator-panel && npm run build

# Validator App installer
cd apps/validator-app && npm run build
```

---

## 🚀 Production Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for complete production deployment instructions including:

- Render/VPS deployment for backend
- EAS Build for mobile app
- Electron packaging for desktop apps
- Vercel deployment for landing page
- Chrome extension on dedicated server

---

## 🔧 Useful Commands

```bash
# === Docker ===
docker-compose up -d                # Start all services
docker-compose down                 # Stop all services
docker-compose logs -f              # View logs
docker-compose restart postgres     # Restart specific service

# === Database ===
cd apps/backend-api
npx prisma studio                   # Open database UI
npx prisma migrate dev              # Create & apply migration
npx prisma generate                 # Regenerate Prisma client
npm run db:seed                     # Seed database

# === Backend ===
cd apps/backend-api
bun run start:dev                   # Development mode
bun run start:prod                  # Production mode
bun run build                       # Build for production
npm run test                        # Run tests

# === Chat App ===
cd apps/chat-app
bun run start                       # Start Expo dev server
bun run ios                         # Run on iOS simulator
bun run android                     # Run on Android emulator
eas build --platform android        # Build APK

# === Health Check ===
./scripts/health-check.sh           # Verify system health
```

---

## 🐛 Troubleshooting

### Backend Won't Start

```bash
# Check if services are running
docker ps

# Check logs
docker-compose logs postgres redis

# Verify environment variables
cat apps/backend-api/.env
```

### Database Connection Issues

```bash
# Test PostgreSQL connection
docker exec -it tiorico-postgres psql -U postgres -d tio_rico_fichas -c "SELECT 1;"

# Check DATABASE_URL
echo $DATABASE_URL
```

### Chat App Can't Reach Backend

If using a physical device, update to your local IP (not `localhost`):

```bash
# Find your IP
ifconfig | grep "inet " | grep -v 127.0.0.1

# Update in apps/chat-app/.env
EXPO_PUBLIC_API_URL="http://192.168.1.100:3000"
```

**More troubleshooting:** See [DEPLOYMENT.md](./DEPLOYMENT.md#troubleshooting)

---

## 📊 Project Status

- ✅ Backend API - Complete
- ✅ Chat App - Complete
- ✅ Operator Panel - Complete
- ✅ Validator App - Complete
- ✅ Automation Extension - Complete
- ✅ Landing Page - Complete
- ✅ Database Schema - Complete
- ✅ Docker Setup - Complete
- ✅ Deployment Guide - Complete

**System is production-ready!** 🎉

---

## 🤝 Contributing

This is a private project. For questions or issues, contact the project maintainers.

---

## 📄 License

Private & Confidential - All Rights Reserved

---

## 🔗 Resources

- [NestJS Documentation](https://docs.nestjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs)
- [Expo Documentation](https://docs.expo.dev/)
- [Electron Documentation](https://www.electronjs.org/docs)
- [Ollama Documentation](https://ollama.com/docs)
- [BullMQ Documentation](https://docs.bullmq.io/)

---

**Built with ❤️ for Tio Rico Fichas**
