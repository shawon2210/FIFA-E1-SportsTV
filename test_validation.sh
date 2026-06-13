#!/usr/bin/env bash
# A1TV Phase 1+ Comprehensive Validation Script
set -e

LOG_FILE="/tmp/a1tv_validation_$(date +%Y%m%d_%H%M%S).log"
PASS=0
FAIL=0
WARN=0

log() { echo "$@" | tee -a "$LOG_FILE"; }
pass() { ((PASS++)); log "  PASS: $1"; }
fail() { ((FAIL++)); log "  FAIL: $1"; }
warn() { ((WARN++)); log "  WARN: $1"; }

SERVER_PORT=3000
BASE="http://localhost:${SERVER_PORT}"

# --- Start server ---
log "=== STARTING SERVER ==="
cd "/mnt/d/all files/Project/FIFA E1 SportsTV/backend"

# Kill any existing server
fuser -k ${SERVER_PORT}/tcp 2>/dev/null || true
sleep 2

node src/server.js > /tmp/a1tv_test_server.log 2>&1 &
SERVER_PID=$!
log "Server PID: $SERVER_PID"

# Wait for server to be ready
READY=0
for i in $(seq 1 30); do
    if ss -tlnp | grep -q ":${SERVER_PORT} "; then
        READY=1
        break
    fi
    sleep 1
done

sleep 3

if [ "$READY" -ne 1 ]; then
    log "SERVER FAILED TO START"
    cat /tmp/a1tv_test_server.log
    exit 1
fi
log "Server is listening on port ${SERVER_PORT}"
cat /tmp/a1tv_test_server.log

# Verify curl works
log ""
log "=== CONNECTIVITY TEST ==="
HEALTH_RESPONSE=$(curl -s --connect-timeout 3 --max-time 5 "${BASE}/health" 2>&1)
if echo "$HEALTH_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ok'" 2>/dev/null; then
    pass "Connectivity: server responds with status=ok"
else
    # Try with explicit 127.00.1
    BASE2="http://127.0.0.1:${SERVER_PORT}"
    HEALTH_RESPONSE=$(curl -s --connect-timeout 3 --max-time 5 "${BASE2}/health" 2>&1)
    if echo "$HEALTH_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ok'" 2>/dev/null; then
        pass "Connectivity: server responds with status=ok (via 127.0.0.1)"
        BASE="$BASE2"
    else
        fail "Connectivity: server not responding. Response: $HEALTH_RESPONSE"
        kill $SERVER_PID 2>/dev/null || true
        exit 1
    fi
fi

# --- Test function ---
test_endpoint() {
    local method="$1"
    local path="$2"
    local expected_status="$3"
    local description="$4"
    local timeout="${5:-8}"
    
    local url="${BASE}${path}"
    local response
    local http_code
    
    response=$(curl -s --connect-timeout 3 --max-time "$timeout" -w "\n%{http_code}" "$url" 2>&1)
    http_code=$(echo "$response" | tail -1)
    local body
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "$expected_status" ]; then
        pass "${method} ${path} -> ${http_code} ${description}"
    elif [ "$expected_status" = "2XX" ] && [[ "$http_code" == 2* ]]; then
        pass "${method} ${path} -> ${http_code} ${description}"
    elif [ "$http_code" = "000" ]; then
        fail "${method} ${path} -> TIMEOUT/REFUSED ${description}"
    else
        fail "${method} ${path} -> ${http_code} (expected ${expected_status}) ${description} body: ${body:0:100}"
    fi
}

# --- Test function with body ---
test_endpoint_post() {
    local path="$1"
    local expected_status="$2"
    local description="$3"
    local data="${4:-{}}"
    local timeout="${5:-8}"
    
    local url="${BASE}${path}"
    local response
    local http_code
    response=$(curl -s --connect-timeout 3 --max-time "$timeout" -w "\n%{http_code}" -X POST -H "Content-Type: application/json" -d "$data" "$url" 2>&1)
    http_code=$(echo "$response" | tail -1)
    local body
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" = "$expected_status" ]; then
        pass "POST ${path} -> ${http_code} ${description}"
    elif [ "$expected_status" = "2XX" ] && [[ "$http_code" == 2* ]]; then
        pass "POST ${path} -> ${http_code} ${description}"
    elif [ "$http_code" = "000" ]; then
        fail "POST ${path} -> TIMEOUT ${description}"
    else
        fail "POST ${path} -> ${http_code} (expected ${expected_status}) ${description} body: ${body:0:100}"
    fi
}

log ""
log "=== PHASE 1: HEALTH CHECKS ==="
test_endpoint GET "/health" 200 "Health endpoint" 5

log ""
log "=== PHASE 1: CHANNELS API ==="
test_endpoint GET "/api/v1/channels?limit=3" 200 "Channel list" 15
test_endpoint GET "/api/v1/channels/featured" 200 "Featured channels" 5
test_endpoint GET "/api/v1/channels/popular" 200 "Popular channels" 5

log ""
log "=== PHASE 1: SEARCH API ==="
test_endpoint GET "/api/v1/search?q=news" "2XX" "Search" 5

log ""
log "=== PHASE 1: CATEGORIES & COUNTRIES ==="
test_endpoint GET "/api/v1/categories" "2XX" "Categories" 5
test_endpoint GET "/api/v1/countries" "2XX" "Countries" 5

log ""
log "=== PHASE 1: STREAM API ==="
test_endpoint GET "/api/v1/stream/test-channel" "2XX" "Stream (fake ID)" 5

log ""
log "=== PHASE 1: EPG API ==="
test_endpoint GET "/api/v1/epg/now" "2XX" "EPG now" 5

log ""
log "=== PHASE 1: RECOMMENDATIONS ==="
test_endpoint GET "/api/v1/recommendations/personalized" "2XX" "Personalized recs" 5
test_endpoint GET "/api/v1/recommendations/v2/feed" "2XX" "Rec v2 feed" 5

log ""
log "=== PHASE 1: SPORTS ==="
test_endpoint GET "/api/v1/sports/hub" "2XX" "Sports hub" 5
test_endpoint GET "/api/v1/sports/live" "2XX" "Live matches" 5

log ""
log "=== PHASE 1: GATEWAY ==="
test_endpoint GET "/api/v1/gateway/status" "2XX" "Gateway status" 5

log ""
log "=== PHASE 1: BILLING ==="
test_endpoint GET "/api/v1/billing/plans" "2XX" "Billing plans" 5

log ""
log "=== PHASE 1: AUTH ==="
test_endpoint_post "/api/v1/auth/register" 400 "Register (incomplete body)" '{"email":"test@test.com"}'
test_endpoint_post "/api/v1/auth/login" 400 "Login (no body)" '{}'
test_endpoint GET "/api/v1/auth/login" 404 "Login via GET (should not exist)" 5

log ""
log "=== PHASE 1: ADMIN ==="
test_endpoint GET "/api/v1/admin/stats" 401 "Admin (unauthorized)" 5

log ""
log "=== PHASE 1: METRICS ==="
test_endpoint GET "/metrics" "2XX" "Prometheus metrics" 5

log ""
log "=== PHASE 1: 404 HANDLING ==="
test_endpoint GET "/api/v1/nonexistent" 404 "Unknown route" 5

# --- Cleanup ---
log ""
log "=== CLEANUP ==="
if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    log "Server stopped"
fi

# --- Summary ---
log ""
log "========================================="
log "VALIDATION SUMMARY"
log "========================================="
log "  PASS: ${PASS}"
log "  FAIL: ${FAIL}"
log "  WARN: ${WARN}"
log "  TOTAL: $((PASS + FAIL + WARN))"
log ""
log "Log saved to: ${LOG_FILE}"
log "========================================="

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
exit 0
