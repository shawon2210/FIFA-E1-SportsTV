// ============================================================
// A1TV v2 — Distributed Rate Limiter (Redis-backed)
// Per-endpoint, per-user/device/IP rate limiting with
// sliding window algorithm.
// ============================================================

const Redis = require('ioredis');
const config = require('../config');

class RateLimiter {
    constructor() {
        this._redis = null;
    }

    getRedis() {
        if (!this._redis) {
            this._redis = new Redis({
                host: config.redis.host,
                port: config.redis.port,
                password: config.redis.password,
                db: config.redis.db,
                keyPrefix: 'rl:',
                lazyConnect: true,
            });
        }
        return this._redis;
    }

    /**
     * Check if a request is allowed.
     * Returns { allowed, remaining, resetTime, limit }
     */
    async check(key, windowSeconds, maxRequests) {
        const now = Date.now();
        const windowStart = now - (windowSeconds * 1000);
        const redisKey = `ratelimit:${key}`;

        try {
            const pipeline = this.getRedis().pipeline();
            pipeline.zremrangebyscore(redisKey, 0, windowStart); // Remove old entries
            pipeline.zadd(redisKey, now, `${now}-${Math.random()}`); // Add current request
            pipeline.zcard(redisKey); // Count requests in window
            pipeline.pexpire(redisKey, windowSeconds * 1000); // Set TTL

            const results = await pipeline.exec();
            const count = results[2][1]; // zcard result

            const allowed = count <= maxRequests;
            const remaining = Math.max(0, maxRequests - count);
            const resetTime = Math.ceil((now + windowSeconds * 1000) / 1000);

            // If over limit, remove the request we just added
            if (!allowed) {
                await this.getRedis().zremrangebyrank(redisKey, -1, -1);
            }

            return { allowed, remaining, resetTime, limit: maxRequests };
        } catch (err) {
            // Redis down — allow request (fail open)
            console.warn('Rate limiter Redis error:', err.message);
            return { allowed: true, remaining: maxRequests, resetTime: 0, limit: maxRequests };
        }
    }

    /**
     * Express middleware factory.
     */
    middleware(options = {}) {
        const {
            windowSeconds = 60,
            maxRequests = 100,
            keyGenerator = (req) => req.ip,
            skipSuccessfulRequests = false,
        } = options;

        return async (req, res, next) => {
            const key = `${keyGenerator(req)}:${req.path}`;
            const result = await this.check(key, windowSeconds, maxRequests);

            // Set rate limit headers
            res.set({
                'X-RateLimit-Limit': result.limit,
                'X-RateLimit-Remaining': result.remaining,
                'X-RateLimit-Reset': result.resetTime,
            });

            if (!result.allowed) {
                if (skipSuccessfulRequests) {
                    res.on('finish', () => {
                        if (res.statusCode < 400) {
                            // Don't count successful requests
                        }
                    });
                }
                return res.status(429).json({
                    success: false,
                    error: 'Too many requests',
                    retryAfter: result.resetTime - Math.ceil(Date.now() / 1000),
                });
            }

            next();
        };
    }

    /**
     * Get rate limit status for a key.
     */
    async status(key, windowSeconds) {
        const now = Date.now();
        const windowStart = now - (windowSeconds * 1000);
        const redisKey = `ratelimit:${key}`;

        const count = await this.getRedis().zcount(redisKey, windowStart, now);
        return { count, windowSeconds };
    }

    /**
     * Reset rate limit for a key.
     */
    async reset(key) {
        await this.getRedis().del(`ratelimit:${key}`);
    }
}

module.exports = new RateLimiter();
