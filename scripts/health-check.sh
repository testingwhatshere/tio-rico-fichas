#!/bin/bash

# ============================================
# Tio Rico Fichas - Health Check Script
# ============================================
# Verifies all services are running correctly
#
# Usage: ./scripts/health-check.sh
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-tiorico-postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-tiorico-redis}"

# Stats
CHECKS_PASSED=0
CHECKS_FAILED=0

# Helper functions
print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

check_pass() {
    echo -e "${GREEN}✅ $1${NC}"
    ((CHECKS_PASSED++))
}

check_fail() {
    echo -e "${RED}❌ $1${NC}"
    ((CHECKS_FAILED++))
}

check_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# ============================================
# 1. CHECK DOCKER SERVICES
# ============================================
print_header "Checking Docker Services"

# PostgreSQL
if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES_CONTAINER}$"; then
    check_pass "PostgreSQL container is running"

    # Test connection
    if docker exec $POSTGRES_CONTAINER psql -U postgres -d tio_rico_fichas -c "SELECT 1;" &> /dev/null; then
        check_pass "PostgreSQL connection successful"
    else
        check_fail "PostgreSQL connection failed"
    fi
else
    check_fail "PostgreSQL container is not running"
fi

# Redis
if docker ps --format '{{.Names}}' | grep -q "^${REDIS_CONTAINER}$"; then
    check_pass "Redis container is running"

    # Test connection
    if docker exec $REDIS_CONTAINER redis-cli ping &> /dev/null; then
        check_pass "Redis connection successful"
    else
        check_fail "Redis connection failed"
    fi
else
    check_fail "Redis container is not running"
fi

# ============================================
# 2. CHECK BACKEND API
# ============================================
print_header "Checking Backend API"

# Health endpoint
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" ${BACKEND_URL}/health 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "200" ]; then
    check_pass "Backend API is responding (HTTP 200)"

    # Parse health check response
    HEALTH_RESPONSE=$(curl -s ${BACKEND_URL}/health 2>/dev/null || echo "{}")

    if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
        check_pass "Backend health status: OK"
    else
        check_warn "Backend health status: Not OK"
    fi

    # Check database connection in health response
    if echo "$HEALTH_RESPONSE" | grep -q '"database".*"up"'; then
        check_pass "Backend → Database connection: UP"
    else
        check_fail "Backend → Database connection: DOWN"
    fi

    # Check Redis connection in health response
    if echo "$HEALTH_RESPONSE" | grep -q '"redis".*"up"'; then
        check_pass "Backend → Redis connection: UP"
    else
        check_fail "Backend → Redis connection: DOWN"
    fi

elif [ "$HTTP_STATUS" = "000" ]; then
    check_fail "Backend API is not reachable at ${BACKEND_URL}"
else
    check_fail "Backend API returned HTTP ${HTTP_STATUS}"
fi

# ============================================
# 3. CHECK DATABASE SCHEMA
# ============================================
print_header "Checking Database Schema"

# Check if key tables exist
TABLES=("User" "Request" "Job" "Chat" "Message" "PaymentConfig" "Setting")

for table in "${TABLES[@]}"; do
    if docker exec $POSTGRES_CONTAINER psql -U postgres -d tio_rico_fichas -c "SELECT COUNT(*) FROM \"$table\";" &> /dev/null; then
        check_pass "Table exists: $table"
    else
        check_fail "Table missing: $table"
    fi
done

# ============================================
# 4. CHECK REDIS QUEUE
# ============================================
print_header "Checking Redis Queue"

# Check if BullMQ queues exist
QUEUE_KEYS=$(docker exec $REDIS_CONTAINER redis-cli KEYS "bull:*" 2>/dev/null | wc -l)

if [ "$QUEUE_KEYS" -gt 0 ]; then
    check_pass "BullMQ queues found: $QUEUE_KEYS keys"
else
    check_warn "No BullMQ queues found (expected if no jobs have been queued yet)"
fi

# ============================================
# 5. CHECK API ENDPOINTS
# ============================================
print_header "Checking API Endpoints"

# Auth endpoint
AUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" ${BACKEND_URL}/auth/status 2>/dev/null || echo "000")
if [ "$AUTH_STATUS" = "200" ] || [ "$AUTH_STATUS" = "401" ]; then
    check_pass "Auth endpoint accessible"
else
    check_warn "Auth endpoint returned HTTP ${AUTH_STATUS}"
fi

# Requests endpoint (should require auth)
REQUESTS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" ${BACKEND_URL}/requests 2>/dev/null || echo "000")
if [ "$REQUESTS_STATUS" = "401" ]; then
    check_pass "Requests endpoint protected (HTTP 401 unauthorized)"
elif [ "$REQUESTS_STATUS" = "200" ]; then
    check_warn "Requests endpoint returned HTTP 200 (auth may not be enforced)"
else
    check_warn "Requests endpoint returned HTTP ${REQUESTS_STATUS}"
fi

# ============================================
# 6. SUMMARY
# ============================================
print_header "Health Check Summary"

TOTAL_CHECKS=$((CHECKS_PASSED + CHECKS_FAILED))
PASS_RATE=$((CHECKS_PASSED * 100 / TOTAL_CHECKS))

echo -e "${GREEN}Passed:${NC} $CHECKS_PASSED / $TOTAL_CHECKS"
echo -e "${RED}Failed:${NC} $CHECKS_FAILED / $TOTAL_CHECKS"
echo -e "${BLUE}Success Rate:${NC} ${PASS_RATE}%"
echo ""

if [ $CHECKS_FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 All checks passed! System is healthy.${NC}"
    exit 0
elif [ $PASS_RATE -ge 80 ]; then
    echo -e "${YELLOW}⚠️  Most checks passed. Review warnings above.${NC}"
    exit 0
else
    echo -e "${RED}❌ Multiple checks failed. System may not be functioning correctly.${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Ensure Docker services are running: docker-compose up -d"
    echo "  2. Check backend logs: docker-compose logs backend"
    echo "  3. Run database migrations: cd apps/backend-api && npx prisma migrate deploy"
    echo "  4. Verify environment variables in apps/backend-api/.env"
    exit 1
fi
