#!/bin/bash
# End-to-end test suite for everything we changed today.
# Hits the prod backend. Read-only where possible; cleans up any test rows it creates.

set -u

API="https://tiorico-api.onrender.com/api"
PASS=0
FAIL=0
FAILED_TESTS=()

# Helper: assert HTTP status code
test_status() {
  local name="$1"; local expected="$2"; local actual="$3"; local body="$4"
  if [[ "$actual" == "$expected" ]]; then
    echo "  ✓ $name (HTTP $actual)"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name (expected $expected, got $actual): $(echo "$body" | head -c 200)"
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("$name")
  fi
}

# Helper: assert body contains string
test_body_contains() {
  local name="$1"; local needle="$2"; local body="$3"
  if echo "$body" | grep -q "$needle"; then
    echo "  ✓ $name (body contiene '$needle')"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name (no contiene '$needle'): $(echo "$body" | head -c 200)"
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("$name")
  fi
}

curl_status() {
  local method="$1"; local url="$2"; shift 2
  curl -s -o /tmp/e2e-body.txt -w "%{http_code}" -X "$method" "$@" "$url"
}

echo ""
echo "════════════════════════════════════════════════════════════════"
echo " E2E test suite — $(date +'%H:%M:%S')"
echo " Backend: $API"
echo "════════════════════════════════════════════════════════════════"

# ─── HEALTH / PUBLIC ───
echo ""
echo "▼ Health + public endpoints"
status=$(curl_status GET "$API/health")
test_status "GET /health responde" "200" "$status" "$(cat /tmp/e2e-body.txt)"

status=$(curl_status GET "$API/settings/public")
test_status "GET /settings/public responde 200" "200" "$status" "$(cat /tmp/e2e-body.txt)"
test_body_contains "settings/public expone supportPhoneNumber" "supportPhoneNumber" "$(cat /tmp/e2e-body.txt)"

# ─── ENDPOINTS NUEVOS (sin auth) ───
echo ""
echo "▼ Endpoints nuevos de hoy"
status=$(curl_status GET "$API/prize-claims/me/active")
test_status "GET /prize-claims/me/active sin auth → 401 (endpoint existe)" "401" "$status" "$(cat /tmp/e2e-body.txt)"

status=$(curl_status GET "$API/users/preloaded")
test_status "GET /users/preloaded sin auth → 401" "401" "$status" "$(cat /tmp/e2e-body.txt)"

status=$(curl_status POST "$API/users/preloaded/bulk" -H "Content-Type: application/json" -d '{"entries":[]}')
test_status "POST /users/preloaded/bulk sin auth → 401" "401" "$status" "$(cat /tmp/e2e-body.txt)"

# ─── AUTH / PRELOADED PHONE LOCK ───
echo ""
echo "▼ Auth + phone lock para preloaded users"
echo "  (usuario de test: ana2t con phone 5493454111164)"

# Phone correcto, formato canonical
status=$(curl_status POST "$API/auth/client" -H "Content-Type: application/json" -d '{"username":"ana2t","phone":"5493454111164"}')
test_status "Login ana2t + phone canonical → 200" "200" "$status" "$(cat /tmp/e2e-body.txt)"
test_body_contains "Login devuelve accessToken" "accessToken" "$(cat /tmp/e2e-body.txt)"

# Mismo phone con +
status=$(curl_status POST "$API/auth/client" -H "Content-Type: application/json" -d '{"username":"ana2t","phone":"+5493454111164"}')
test_status "Login ana2t + phone con + → 200 (canonicaliza)" "200" "$status" "$(cat /tmp/e2e-body.txt)"

# Mismo phone con espacios + dashes
status=$(curl_status POST "$API/auth/client" -H "Content-Type: application/json" -d '{"username":"ana2t","phone":"+54 9 3454 11-1164"}')
test_status "Login ana2t + phone con espacios y dashes → 200" "200" "$status" "$(cat /tmp/e2e-body.txt)"

# Phone WRONG (de otro user)
status=$(curl_status POST "$API/auth/client" -H "Content-Type: application/json" -d '{"username":"ana2t","phone":"5499999999999"}')
test_status "Login ana2t + phone wrong → 401" "401" "$status" "$(cat /tmp/e2e-body.txt)"
test_body_contains "Mensaje claro phone mismatch" "número" "$(cat /tmp/e2e-body.txt | tr 'A-Z' 'a-z')"

# Sin phone (debe pedirlo)
status=$(curl_status POST "$API/auth/client" -H "Content-Type: application/json" -d '{"username":"ana2t"}')
test_status "Login ana2t sin phone → 400 PHONE_REQUIRED" "400" "$status" "$(cat /tmp/e2e-body.txt)"
test_body_contains "PHONE_REQUIRED en respuesta" "PHONE_REQUIRED" "$(cat /tmp/e2e-body.txt)"

# Registro nuevo con phone duplicado
TEST_USER="e2e_dup_test_$(date +%s)"
status=$(curl_status POST "$API/auth/client" -H "Content-Type: application/json" -d "{\"username\":\"$TEST_USER\",\"phone\":\"5493454111164\"}")
test_status "Registro con phone existente de preloaded → 400" "400" "$status" "$(cat /tmp/e2e-body.txt)"
test_body_contains "Mensaje 'ya está registrado'" "ya está registrado" "$(cat /tmp/e2e-body.txt)"

# Username reservado
status=$(curl_status POST "$API/auth/client" -H "Content-Type: application/json" -d '{"username":"admin","phone":"5491111111111"}')
test_status "Login con username reservado → 400" "400" "$status" "$(cat /tmp/e2e-body.txt)"

# Username inválido (corto)
status=$(curl_status POST "$API/auth/client" -H "Content-Type: application/json" -d '{"username":"a","phone":"5491111111111"}')
test_status "Login con username muy corto → 400" "400" "$status" "$(cat /tmp/e2e-body.txt)"

# ─── RESUMEN ───
echo ""
echo "════════════════════════════════════════════════════════════════"
echo " RESULTADOS"
echo "════════════════════════════════════════════════════════════════"
echo " ✓ Pasaron: $PASS"
echo " ✗ Fallaron: $FAIL"
if (( FAIL > 0 )); then
  echo ""
  echo " Tests fallidos:"
  for t in "${FAILED_TESTS[@]}"; do echo "   - $t"; done
fi
echo ""
