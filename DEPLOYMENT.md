# A1TV v2 — Production Deployment Guide

## Prerequisites

- Docker 24+ and Docker Compose v2+
- 2GB+ RAM, 2+ CPU cores
- 20GB+ disk space
- Domain name (optional, for SSL)

## Quick Start

```bash
# 1. Clone and configure
git clone <repo> && cd "FIFA E1 SportsTV"
cp .env.example .env
# Edit .env with your settings

# 2. Start all services
docker compose -f docker/docker-compose.yml up -d

# 3. Run database migrations
docker exec a1tv-api npx knex migrate:latest

# 4. Initial data sync
docker exec a1tv-api node scripts/sync.js

# 5. Verify
curl http://localhost:8080/health
```

## Architecture

```
Port 8080 → Nginx
├── /           → Frontend (static)
├── /api/v1/*   → API Server (port 3000)
├── /socket.io  → WebSocket (port 3000)
└── /health     → Health check

Internal:
- API Server: port 3000
- Workers: background jobs
- PostgreSQL: port 5432
- Redis: port 6379
```

## Service Management

```bash
# View logs
docker compose -f docker/docker-compose.yml logs -f api
docker compose -f docker/docker-compose.yml logs -f workers

# Restart a service
docker compose -f docker/docker-compose.yml restart api

# Scale workers (if needed)
docker compose -f docker/docker-compose.yml up -d --scale workers=2

# Database backup
docker exec a1tv-postgres pg_dump -U a1tv a1tv | gzip > backup_$(date +%Y%m%d).sql.gz

# View worker queue status
docker exec a1tv-workers node -e "const q = require('./src/workers'); console.log(q.queues);"
```

## Scheduled Jobs

| Job | Frequency | Description |
|-----|-----------|-------------|
| IPTV Sync | Every 6h | Fetch channels/streams from all sources |
| Health Check | Every 5 min | Validate all active streams |
| Stream Scoring | Every 15 min | Recalculate quality scores |
| Metrics Aggregation | Every hour | Aggregate hourly metrics |
| EPG Scoring | Every 6h | Score EPG source quality |
| Recommendations | Daily 2 AM | Regenerate channel recommendations |
| Alert Checks | Every minute | Check alert rules |
| Backup | Daily 3 AM | Full Postgres backup |

## Monitoring

```bash
# Health check
curl http://localhost:8080/health

# Stream health stats
curl http://localhost:8080/api/v1/health

# Database stats
docker exec a1tv-postgres psql -U a1tv -c "SELECT COUNT(*) FROM channels WHERE is_active = true;"
docker exec a1tv-postgres psql -U a1tv -c "SELECT status, COUNT(*) FROM streams WHERE is_active = true GROUP BY status;"

# Redis stats
docker exec a1tv-redis redis-cli info stats
```

## Troubleshooting

```bash
# Check API logs
docker logs a1tv-api --tail 100

# Check worker logs
docker logs a1tv-workers --tail 100

# Database connection test
docker exec a1tv-api node -e "const db = require('./src/config/database'); db.raw('SELECT 1').then(() => console.log('DB OK')).catch(e => console.error('DB FAIL:', e.message));"

# Redis connection test
docker exec a1tv-api node -e "const c = require('./src/services/cache'); c.connect().then(() => console.log('Redis OK')).catch(e => console.error('Redis FAIL:', e.message));"
```

## SSL (Production)

Use Certbot with Nginx:

```bash
sudo certbot --nginx -d yourdomain.com
```

Or use Cloudflare's free SSL proxy.

## Backup Strategy

- Automated daily Postgres backups via BullMQ worker
- Redis AOF persistence enabled
- Backups stored locally at `/tmp/a1tv-backups`
- Configure S3/R2 in .env for offsite backups
- Retention: 30 days (configurable)

## Scaling

For 10,000+ channels:
- Increase `DB_POOL_MAX` to 20
- Run multiple worker instances
- Use PostgreSQL read replica for API queries
- Enable Redis Cluster
- Use CDN for static assets and logos
