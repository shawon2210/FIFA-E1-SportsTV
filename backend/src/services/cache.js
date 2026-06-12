// ============================================================
// A1TV Backend — Redis Cache Layer
// ============================================================

const Redis = require('ioredis');
const config = require('../config');

class Cache {
    constructor() {
        this.client = new Redis({
            host: config.redis.host,
            port: config.redis.port,
            password: config.redis.password,
            db: config.redis.db,
            keyPrefix: config.redis.keyPrefix,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3,
            lazyConnect: true,
        });

        this.client.on('connect', () => console.log('✓ Redis connected'));
        this.client.on('error', (err) => console.error('✗ Redis error:', err.message));
    }

    async connect() {
        try {
            await this.client.connect();
        } catch (err) {
            console.warn('Redis connection failed, running without cache:', err.message);
            this.disabled = true;
        }
    }

    async get(key) {
        if (this.disabled) return null;
        try {
            const val = await this.client.get(key);
            return val ? JSON.parse(val) : null;
        } catch {
            return null;
        }
    }

    async set(key, value, ttlSeconds) {
        if (this.disabled) return;
        try {
            const serialized = JSON.stringify(value);
            if (ttlSeconds) {
                await this.client.setex(key, ttlSeconds, serialized);
            } else {
                await this.client.set(key, serialized);
            }
        } catch (err) {
            console.warn('Cache set failed:', err.message);
        }
    }

    async del(key) {
        if (this.disabled) return;
        try {
            await this.client.del(key);
        } catch {}
    }

    async delPattern(pattern) {
        if (this.disabled) return;
        try {
            const keys = await this.client.keys(`a1tv:${pattern}`);
            if (keys.length > 0) {
                const unprefixed = keys.map(k => k.replace('a1tv:', ''));
                await this.client.del(...unprefixed);
            }
        } catch {}
    }

    async flush() {
        if (this.disabled) return;
        try {
            await this.client.flushdb();
        } catch {}
    }

    async getOrSet(key, ttlSeconds, factory) {
        const cached = await this.get(key);
        if (cached !== null) return cached;
        const value = await factory();
        await this.set(key, value, ttlSeconds);
        return value;
    }

    // Cache tags for grouped invalidation
    async setWithTags(key, value, ttlSeconds, tags) {
        await this.set(key, value, ttlSeconds);
        if (this.disabled) return;
        try {
            for (const tag of tags) {
                await this.client.sadd(`tag:${tag}`, key);
            }
        } catch {}
    }

    async invalidateTag(tag) {
        if (this.disabled) return;
        try {
            const keys = await this.client.smembers(`tag:${tag}`);
            if (keys.length > 0) {
                await this.client.del(...keys);
                await this.client.del(`tag:${tag}`);
            }
        } catch {}
    }

    async quit() {
        try {
            await this.client.quit();
        } catch {}
    }
}

module.exports = new Cache();
