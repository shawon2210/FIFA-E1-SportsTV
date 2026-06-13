#!/bin/bash
# A1TV Persistent Startup
# Uses double-fork daemon pattern so processes survive shell exit

PROJECT="/mnt/d/all files/Project/FIFA E1 SportsTV"
BACKEND_PORT=3000
PROXY_PORT=8081

# Kill stale
fuser -k $BACKEND_PORT/tcp 2>/dev/null
fuser -k $PROXY_PORT/tcp 2>/dev/null
sleep 1

# Start backend as daemon (double fork)
(
  cd "$PROJECT/backend"
  exec node src/server.js
) > /tmp/backend.log 2>&1 &
disown

echo "Backend starting (PID: $!)..."
sleep 3

# Verify backend
for i in $(seq 1 15); do
  if curl -s --max-time 2 http://localhost:$BACKEND_PORT/health > /dev/null 2>&1; then
    echo "Backend ready on port $BACKEND_PORT"
    break
  fi
  sleep 1
done

# Start proxy as daemon (double fork)
(
  cd "$PROJECT"
  exec node proxy-server.js
) > /tmp/proxy.log 2>&1 &
disown

echo "Proxy starting (PID: $!)..."
sleep 2

# Verify proxy
for i in $(seq 1 10); do
  if curl -s --max-time 2 http://localhost:$PROXY_PORT/ > /dev/null 2>&1; then
    echo "Proxy ready on port $PROXY_PORT"
    break
  fi
  sleep 1
done

echo ""
echo "=== A1TV Running ==="
echo "Frontend:  http://localhost:$PROXY_PORT"
echo "API:       http://localhost:$BACKEND_PORT/api/v1/"
echo "Health:    $(curl -s --max-time 3 http://localhost:$BACKEND_PORT/health 2>&1)"
echo "Channels:  $(curl -s --max-time 5 "http://localhost:$BACKEND_PORT/api/v1/channels?limit=1" 2>&1 | grep -o '"total":[0-9]*' | head -1)"
