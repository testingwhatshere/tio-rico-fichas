#!/bin/bash

# ============================================
# Tio Rico Fichas - Initial Setup Script
# ============================================
# This script helps you set up the development environment
#
# Usage: ./scripts/setup.sh
# ============================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# ============================================
# 1. WELCOME
# ============================================
clear
print_header "Tio Rico Fichas - Setup Wizard"
echo "This script will help you set up the development environment."
echo ""
echo "What will be set up:"
echo "  • Docker containers (PostgreSQL + Redis)"
echo "  • Environment variables"
echo "  • Database schema and migrations"
echo "  • Sample data for testing"
echo ""
read -p "Press Enter to continue..."

# ============================================
# 2. CHECK PREREQUISITES
# ============================================
print_header "Checking Prerequisites"

# Check Node.js
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    print_success "Node.js installed: $NODE_VERSION"
else
    print_error "Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Bun
if command -v bun &> /dev/null; then
    BUN_VERSION=$(bun --version)
    print_success "Bun installed: $BUN_VERSION"
else
    print_warning "Bun is not installed. Installing dependencies will use npm instead."
fi

# Check Docker
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    print_success "Docker installed: $DOCKER_VERSION"
else
    print_error "Docker is not installed. Please install Docker Desktop first."
    exit 1
fi

# Check Docker Compose
if command -v docker-compose &> /dev/null || docker compose version &> /dev/null 2>&1; then
    print_success "Docker Compose available"
else
    print_error "Docker Compose is not available. Please install Docker Compose."
    exit 1
fi

# ============================================
# 3. INSTALL DEPENDENCIES
# ============================================
print_header "Installing Dependencies"

if command -v bun &> /dev/null; then
    print_info "Installing with Bun..."
    bun install
else
    print_info "Installing with npm..."
    npm install
fi

print_success "Dependencies installed"

# ============================================
# 4. START DOCKER SERVICES
# ============================================
print_header "Starting Docker Services"

print_info "Starting PostgreSQL and Redis..."
docker-compose up -d postgres redis

print_info "Waiting for services to be healthy..."
sleep 5

# Check if containers are running
if docker ps | grep -q "tiorico-postgres"; then
    print_success "PostgreSQL is running"
else
    print_error "Failed to start PostgreSQL"
    exit 1
fi

if docker ps | grep -q "tiorico-redis"; then
    print_success "Redis is running"
else
    print_error "Failed to start Redis"
    exit 1
fi

# ============================================
# 5. CONFIGURE ENVIRONMENT VARIABLES
# ============================================
print_header "Configuring Environment Variables"

# Backend API
if [ ! -f "apps/backend-api/.env" ]; then
    print_info "Creating backend-api .env file..."
    cp apps/backend-api/.env.example apps/backend-api/.env
    print_success "Created apps/backend-api/.env"
    print_warning "Please review and update apps/backend-api/.env with your settings"
else
    print_info "Backend .env already exists"
fi

# Chat App
if [ ! -f "apps/chat-app/.env" ]; then
    print_info "Creating chat-app .env file..."
    cp apps/chat-app/.env.example apps/chat-app/.env
    print_success "Created apps/chat-app/.env"
else
    print_info "Chat app .env already exists"
fi

# ============================================
# 6. SETUP DATABASE
# ============================================
print_header "Setting Up Database"

cd apps/backend-api

print_info "Generating Prisma Client..."
npx prisma generate

print_info "Running database migrations..."
npx prisma migrate deploy || npx prisma db push

print_success "Database schema created"

# Ask if user wants to seed
echo ""
read -p "Do you want to seed the database with sample data? (y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    print_info "Seeding database..."
    npm run db:seed
    print_success "Database seeded with sample data"
    echo ""
    print_info "Login credentials:"
    echo "  Admin: admin@tiorico.com / admin123"
    echo "  Operator: operator1@tiorico.com / operator123"
    echo "  Client: juan123 / client123"
fi

cd ../..

# ============================================
# 7. BUILD APPS (Optional)
# ============================================
print_header "Building Applications"

echo "Do you want to build the backend API now? (y/n)"
read -p "> " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd apps/backend-api
    print_info "Building backend API..."
    npm run build
    print_success "Backend API built successfully"
    cd ../..
fi

# ============================================
# 8. SUMMARY
# ============================================
print_header "Setup Complete! 🎉"

echo "Your development environment is ready!"
echo ""
echo "${GREEN}Services Running:${NC}"
echo "  • PostgreSQL: localhost:5432"
echo "  • Redis: localhost:6379"
echo ""
echo "${YELLOW}Next Steps:${NC}"
echo ""
echo "1. Review environment variables:"
echo "   ${BLUE}vi apps/backend-api/.env${NC}"
echo ""
echo "2. Start the backend API:"
echo "   ${BLUE}cd apps/backend-api && bun run start:dev${NC}"
echo ""
echo "3. Start the chat app (in a new terminal):"
echo "   ${BLUE}cd apps/chat-app && bun run start${NC}"
echo ""
echo "4. Start the operator panel (Electron app):"
echo "   ${BLUE}cd apps/operator-panel && npm start${NC}"
echo ""
echo "5. Start the validator app (Electron app):"
echo "   ${BLUE}cd apps/validator-app && npm start${NC}"
echo ""
echo "${YELLOW}Optional Management Tools:${NC}"
echo ""
echo "  • pgAdmin (Database UI): ${BLUE}docker-compose --profile tools up -d pgadmin${NC}"
echo "    Then visit: http://localhost:5050 (admin@tiorico.com / admin)"
echo ""
echo "  • Redis Commander: ${BLUE}docker-compose --profile tools up -d redis-commander${NC}"
echo "    Then visit: http://localhost:8081"
echo ""
echo "  • Prisma Studio: ${BLUE}cd apps/backend-api && npx prisma studio${NC}"
echo ""
echo "${YELLOW}Useful Commands:${NC}"
echo ""
echo "  • Stop Docker services: ${BLUE}docker-compose down${NC}"
echo "  • View logs: ${BLUE}docker-compose logs -f${NC}"
echo "  • Reset database: ${BLUE}cd apps/backend-api && npx prisma migrate reset${NC}"
echo ""
echo "For more information, see DEPLOYMENT.md"
echo ""
