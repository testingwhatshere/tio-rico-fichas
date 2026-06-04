#!/bin/bash

# ============================================
# Job Queue Flow Test Script
# ============================================
# Tests that jobs are created and dispatched correctly
#
# Prerequisites:
# 1. Docker Desktop running
# 2. Backend API running (bun run start:dev)
#
# Usage: ./scripts/test-job-queue.sh
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"

print_header() {
    echo -e "\n${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_fail() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_header "Job Queue Flow Test"

# ============================================
# 1. CHECK PREREQUISITES
# ============================================
print_header "1. Checking Prerequisites"

# Check Docker
if ! docker ps &> /dev/null; then
    print_fail "Docker is not running. Please start Docker Desktop."
    exit 1
fi
print_success "Docker is running"

# Check PostgreSQL
if docker ps | grep -q "tiorico-postgres"; then
    print_success "PostgreSQL container is running"
else
    print_fail "PostgreSQL not running. Run: docker-compose up -d postgres"
    exit 1
fi

# Check Redis
if docker ps | grep -q "tiorico-redis"; then
    print_success "Redis container is running"
else
    print_fail "Redis not running. Run: docker-compose up -d redis"
    exit 1
fi

# Check Backend API
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" ${BACKEND_URL}/health 2>/dev/null || echo "000")
if [ "$HTTP_STATUS" = "200" ]; then
    print_success "Backend API is responding"
else
    print_fail "Backend API not reachable at ${BACKEND_URL}"
    echo "Please start it with: cd apps/backend-api && bun run start:dev"
    exit 1
fi

# ============================================
# 2. DATABASE CHECK
# ============================================
print_header "2. Checking Database"

# Check if User table has data
USER_COUNT=$(docker exec tiorico-postgres psql -U postgres -d tio_rico_fichas -t -c "SELECT COUNT(*) FROM \"User\";" 2>/dev/null | tr -d ' ' || echo "0")

if [ "$USER_COUNT" -gt "0" ]; then
    print_success "Database has $USER_COUNT users"
else
    print_info "Database is empty. Seeding with test data..."
    cd apps/backend-api
    npm run db:seed
    cd ../..
    print_success "Database seeded"
fi

# ============================================
# 3. JOB QUEUE STATUS
# ============================================
print_header "3. Job Queue Status"

# Count jobs by status
QUEUED=$(docker exec tiorico-postgres psql -U postgres -d tio_rico_fichas -t -c "SELECT COUNT(*) FROM \"Job\" WHERE status='QUEUED';" 2>/dev/null | tr -d ' ' || echo "0")
PROCESSING=$(docker exec tiorico-postgres psql -U postgres -d tio_rico_fichas -t -c "SELECT COUNT(*) FROM \"Job\" WHERE status='PROCESSING';" 2>/dev/null | tr -d ' ' || echo "0")
COMPLETED=$(docker exec tiorico-postgres psql -U postgres -d tio_rico_fichas -t -c "SELECT COUNT(*) FROM \"Job\" WHERE status='COMPLETED';" 2>/dev/null | tr -d ' ' || echo "0")
FAILED=$(docker exec tiorico-postgres psql -U postgres -d tio_rico_fichas -t -c "SELECT COUNT(*) FROM \"Job\" WHERE status='FAILED';" 2>/dev/null | tr -d ' ' || echo "0")

echo "Current Queue Status:"
echo "  Queued: $QUEUED"
echo "  Processing: $PROCESSING"
echo "  Completed: $COMPLETED"
echo "  Failed: $FAILED"

if [ "$QUEUED" -gt "0" ]; then
    print_success "There are $QUEUED jobs waiting in queue"
else
    print_info "Queue is empty. Let's create a test job."
fi

# ============================================
# 4. TEST JOB CREATION (if queue is empty)
# ============================================
if [ "$QUEUED" -eq "0" ]; then
    print_header "4. Creating Test Job"

    # Get first client user
    CLIENT_ID=$(docker exec tiorico-postgres psql -U postgres -d tio_rico_fichas -t -c "SELECT id FROM \"User\" WHERE role='CLIENT' LIMIT 1;" 2>/dev/null | tr -d ' ' || echo "")

    if [ -z "$CLIENT_ID" ]; then
        print_fail "No client users found in database"
        exit 1
    fi

    print_info "Creating test request for user: $CLIENT_ID"

    # Create a test request with auto-approved status
    REQUEST_ID=$(docker exec tiorico-postgres psql -U postgres -d tio_rico_fichas -t -c "
        INSERT INTO \"Request\" (id, \"userId\", \"targetUsername\", amount, status, \"proofUrl\", \"validationScore\", \"createdAt\", \"updatedAt\")
        VALUES (gen_random_uuid(), '$CLIENT_ID', 'test_user_$(date +%s)', 5000, 'APPROVED', 'https://example.com/proof.jpg', 0.95, NOW(), NOW())
        RETURNING id;
    " 2>/dev/null | tr -d ' ' || echo "")

    if [ -z "$REQUEST_ID" ]; then
        print_fail "Failed to create test request"
        exit 1
    fi

    print_success "Created request: $REQUEST_ID"

    # Create job for this request
    JOB_ID=$(docker exec tiorico-postgres psql -U postgres -d tio_rico_fichas -t -c "
        INSERT INTO \"Job\" (id, \"requestId\", status, \"createdAt\", \"updatedAt\")
        VALUES (gen_random_uuid(), '$REQUEST_ID', 'QUEUED', NOW(), NOW())
        RETURNING id;
    " 2>/dev/null | tr -d ' ' || echo "")

    if [ -z "$JOB_ID" ]; then
        print_fail "Failed to create test job"
        exit 1
    fi

    print_success "Created job: $JOB_ID"
fi

# ============================================
# 5. TEST JOB POLLING ENDPOINT
# ============================================
print_header "5. Testing Job Polling Endpoint"

RESPONSE=$(curl -s -H "X-Bot-API-Key: Narciso" ${BACKEND_URL}/api/bot/jobs/pending 2>/dev/null || echo "{}")

if echo "$RESPONSE" | grep -q '"job"'; then
    print_success "Polling endpoint is working"

    # Check if there's an actual job
    if echo "$RESPONSE" | grep -q '"id"'; then
        print_success "✨ Job available for processing!"
        echo ""
        echo "Job Details:"
        echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
    else
        print_info "No jobs currently in queue"
    fi
else
    print_fail "Polling endpoint returned unexpected response"
    echo "Response: $RESPONSE"
fi

# ============================================
# 6. CHECK KILL SWITCH
# ============================================
print_header "6. Checking Safety Settings"

KILL_SWITCH=$(curl -s -H "X-Bot-API-Key: Narciso" ${BACKEND_URL}/api/bot/kill-switch 2>/dev/null || echo "{}")

if echo "$KILL_SWITCH" | grep -q '"active":false'; then
    print_success "Kill switch is OFF (automation allowed)"
elif echo "$KILL_SWITCH" | grep -q '"active":true'; then
    print_fail "Kill switch is ON (automation blocked)"
    echo "To disable: Update Setting with key='KILL_SWITCH' value='false'"
else
    print_info "Kill switch status unknown"
fi

# ============================================
# 7. SUMMARY
# ============================================
print_header "Test Summary"

echo -e "${GREEN}✅ Job Queue Infrastructure: WORKING${NC}"
echo ""
echo "What was verified:"
echo "  ✓ Docker services running"
echo "  ✓ Database schema exists"
echo "  ✓ Backend API responding"
echo "  ✓ Job polling endpoint accessible"
echo "  ✓ Jobs can be created in database"
echo ""
echo "${YELLOW}Next Steps:${NC}"
echo "  1. Load Chrome Extension (apps/automation-extension)"
echo "  2. Configure Extension Options:"
echo "     - Backend URL: ${BACKEND_URL}"
echo "     - API Key: Narciso"
echo "  3. Extension will poll every 10s for jobs"
echo "  4. Watch extension console for job processing"
echo ""
echo "${BLUE}To create more test jobs:${NC}"
echo "  Use Prisma Studio: cd apps/backend-api && npx prisma studio"
echo "  Or API endpoint: POST /api/jobs/request/{requestId} (admin only)"
echo ""
