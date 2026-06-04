# ============================================
# GAME AUTOMATION PLATFORM - Makefile
# ============================================
#
# Quick reference:
#   make setup     - First time setup
#   make dev       - Start development
#   make stop      - Stop all services
#

.PHONY: help setup dev stop logs db-migrate db-studio clean

# Default target
help:
	@echo ""
	@echo "Game Automation Platform - Available Commands"
	@echo "=============================================="
	@echo ""
	@echo "  make setup        First time setup (install deps, start infra, migrate)"
	@echo "  make dev          Start all services for development"
	@echo "  make stop         Stop Docker services"
	@echo "  make logs         View Docker logs"
	@echo ""
	@echo "  make infra        Start infrastructure only (Postgres, Redis)"
	@echo "  make infra-stop   Stop infrastructure"
	@echo ""
	@echo "  make db-migrate   Run Prisma migrations"
	@echo "  make db-studio    Open Prisma Studio"
	@echo "  make db-reset     Reset database (WARNING: destroys data)"
	@echo ""
	@echo "  make backend      Start backend API"
	@echo "  make bot          Start automation bot"
	@echo "  make operator     Start operator panel"
	@echo "  make chat         Start chat app (Expo)"
	@echo ""
	@echo "  make clean        Stop everything and remove volumes"
	@echo ""

# ==========================================
# SETUP
# ==========================================

setup:
	@echo "🚀 Setting up Game Automation Platform..."
	@echo ""
	@echo "1. Installing dependencies..."
	bun install
	@echo ""
	@echo "2. Starting infrastructure (Postgres, Redis)..."
	docker-compose up -d postgres redis
	@echo ""
	@echo "3. Waiting for Postgres to be ready..."
	@sleep 5
	@echo ""
	@echo "4. Running database migrations..."
	cd apps/backend-api && npx prisma migrate dev --name init
	@echo ""
	@echo "5. Installing Playwright browsers..."
	cd apps/automation-bot && bun run install-browsers
	@echo ""
	@echo "✅ Setup complete!"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Copy .env.example to .env and configure"
	@echo "  2. Run 'make dev' to start development"
	@echo ""

# ==========================================
# DEVELOPMENT
# ==========================================

dev: infra
	@echo "🚀 Starting development servers..."
	@echo "   Backend API:     http://localhost:3000"
	@echo "   Operator Panel:  http://localhost:3002"
	@echo "   Bot API:         http://localhost:3001"
	@echo ""
	@echo "Starting services in separate terminals..."
	@echo "Run these commands in separate terminals:"
	@echo "  make backend"
	@echo "  make operator"
	@echo "  make bot"
	@echo ""

infra:
	@echo "🐳 Starting infrastructure..."
	docker-compose up -d postgres redis
	@echo "✅ Postgres: localhost:5432"
	@echo "✅ Redis: localhost:6379"

infra-stop:
	docker-compose stop postgres redis

stop:
	docker-compose stop

logs:
	docker-compose logs -f

# ==========================================
# DATABASE
# ==========================================

db-migrate:
	cd apps/backend-api && npx prisma migrate dev

db-studio:
	cd apps/backend-api && npx prisma studio

db-reset:
	@echo "⚠️  This will destroy all data. Are you sure? [y/N]"
	@read -r confirm && [ "$$confirm" = "y" ] && cd apps/backend-api && npx prisma migrate reset || echo "Cancelled"

db-seed:
	cd apps/backend-api && npx prisma db seed

# ==========================================
# INDIVIDUAL SERVICES
# ==========================================

backend:
	cd apps/backend-api && bun run start:dev

bot:
	cd apps/automation-bot && bun run dev

operator:
	cd apps/operator-panel && bun run dev

chat:
	cd apps/chat-app && bun run start

# ==========================================
# CLEANUP
# ==========================================

clean:
	@echo "🧹 Stopping and removing everything..."
	docker-compose down -v
	@echo "✅ Clean complete"
