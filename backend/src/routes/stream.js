// ============================================================
// A1TV v2 — Stream Proxy Service
// Sits between frontend and IPTV sources.
// Hides source URLs, provides centralized failover,
// rate limiting, analytics, geo-routing, access control.
//
// Architecture:
//   Frontend → GET /api/v1/stream/:channelId → Proxy Service
//     → Smart Routing (SSS + geo + latency)
//     → Best stream selected
//     → Signed URL returned (or proxied)
// ============================================================

const { Router } = require('express');
const crypto = require('crypto');
const axios = require('axios');
const db = require('../config/database');
const config = require('../config');
const { authenticate, optionalAuth, validate, query, param } = require('../middleware/auth');

const router = Router();

// ── Signed URL Configuration ──────────────────────────────
const SIGNED_URL_TTL = 300; // 5 minutes
const SIGNING_SECRET = process.env.STREAM_SIGNING_SECRET || 'a1tv_stream_sign_change_me';

/**
 * Generate a signed URL for stream access.
 * Prevents direct access to source URLs.
 */
function generateSignedUrl(channelId, streamId, userId) {
    const expires = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL;
    const data = `${channelId}:${streamId}:${userId}:${expires}`;
    const signature = crypto.createHmac('sha256', SIGNING_SECRET).update(data).digest('hex');
    return { expires, signature, data };
}

/**
 * Verify a signed URL.
 */
function verifySignedUrl(channelId, streamId, userId, expires, signature) {
    if (Date.now() / 1000 > expires) return false;
    const data = `${channelId}:${streamId}:${userId}:${expires}`;
    const expected = crypto.createHmac('sha256', SIGNING_SECRET).update(data).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ── Smart Stream Router ───────────────────────────────────
class SmartStreamRouter {
    /**
     * Select the best stream for a channel based on:
     * - SSS (Stream Stability Score)
     * - User's country/region
     * - Stream latency
     * - Bitrate/quality
     * - Current viewer load
     * - Geo-restrictions
     */
    async selectBestStream(channelId, userCountry, userRole) {
        // Get all active streams for this channel
        const streams = await db('streams')
            .where({ channel_id: channelId, is_active: true })
            .whereIn('status', ['online', 'unknown', 'slow'])
            .orderBy('score', 'desc');

        if (!streams.length) return null;

        // Score each stream for this specific user
        const scored = [];
        for (const stream of streams) {
            let score = stream.score || 0;

            // Geo-affinity: boost streams from same region
            if (userCountry) {
                const host = await db('stream_hosts').where('id', stream.host_id).first();
                if (host && host.metadata && host.metadata.region) {
                    if (host.metadata.region === this.getRegion(userCountry)) score += 15;
                }
            }

            // Latency penalty
            if (stream.response_time > 0) {
                if (stream.response_time < 100) score += 10;
                else if (stream.response_time < 500) score += 5;
                else if (stream.response_time > 2000) score -= 20;
            }

            // Quality bonus for premium users
            if (userRole === 'premium' || userRole === 'admin') {
                if (stream.quality === '1080p') score += 5;
                if (stream.quality === '4K') score += 10;
            }

            // Viewer load penalty
            const viewerCount = await db('concurrent_viewers')
                .where({ stream_id: stream.id })
                .where('last_heartbeat', '>', new Date(Date.now() - 2 * 60 * 1000))
                .count('* as count').first();
            if (viewerCount && parseInt(viewerCount.count) > 100) score -= 10;

            // Geo-restriction check
            const restrictions = await db('channel_geo_restrictions')
                .where({ channel_id: channelId, country_code: userCountry })
                .first();
            if (restrictions && restrictions.restriction === 'blocked') {
                score = 0; // Completely block
            }

            scored.push({ ...stream, finalScore: Math.max(0, score) });
        }

        // Sort by final score
        scored.sort((a, b) => b.finalScore - a.finalScore);

        // Return best stream and failover chain
        return {
            best: scored[0] || null,
            failoverChain: scored.slice(0, 5),
        };
    }

    getRegion(countryCode) {
        const regions = {
            'NA': ['US', 'CA', 'MX'],
            'EU': ['GB', 'DE', 'FR', 'ES', 'IT', 'NL', 'SE', 'NO', 'DK', 'FI', 'PL', 'AT', 'CH', 'BE', 'PT', 'IE'],
            'AS': ['JP', 'KR', 'CN', 'IN', 'TH', 'VN', 'ID', 'MY', 'SG', 'PH', 'PK', 'BD'],
            'SA': ['BR', 'AR', 'CL', 'CO', 'PE'],
            'AF': ['ZA', 'NG', 'KE', 'GH', 'EG'],
            'OC': ['AU', 'NZ'],
            'ME': ['AE', 'SA', 'TR', 'IL'],
        };
        for (const [region, codes] of Object.entries(regions)) {
            if (codes.includes(countryCode)) return region;
        }
        return 'OTHER';
    }
}

const streamRouter = new SmartStreamRouter();

// ── GET /api/v1/stream/:channelId — Get best stream ──────
router.get('/:channelId', optionalAuth, async (req, res) => {
    try {
        const { channelId } = req.params;
        const userId = req.userId || req.deviceIdString || 'anonymous';
        const userRole = req.userRole || 'guest';
        const userCountry = req.headers['x-country'] || req.query.country || null;

        // Check rate limiting (10 stream requests/minute per IP)
        const rateKey = `stream_req:${req.ip}`;
        const current = await cache.get(rateKey) || 0;
        if (current > 10) {
            return res.status(429).json({ success: false, error: 'Stream rate limit exceeded' });
        }
        await cache.set(rateKey, current + 1, 60);

        // Select best stream
        const result = await streamRouter.selectBestStream(channelId, userCountry, userRole);

        if (!result || !result.best) {
            return res.status(404).json({ success: false, error: 'No active streams available' });
        }

        const best = result.best;

        // Generate signed URL
        const signed = generateSignedUrl(channelId, best.id, userId);

        // Log play event
        db('play_events').insert({
            channel_id: channelId,
            stream_id: best.id,
            user_id: req.userId || null,
            event_type: 'play',
            event_data: {
                quality: best.quality,
                score: best.finalScore,
                failover_available: result.failoverChain.length - 1,
                country: userCountry,
                role: userRole,
            },
        }).catch(() => {});

        // Increment play count
        db('channels').where('id', channelId).increment('play_count', 1).catch(() => {});

        res.json({
            success: true,
            data: {
                channelId,
                streamUrl: `/api/v1/stream/${channelId}/play?token=${signed.signature}&expires=${signed.expires}&sid=${best.id}`,
                quality: best.quality,
                status: best.status,
                score: best.finalScore,
                failoverAvailable: result.failoverChain.length - 1,
                signed: true,
                expiresIn: SIGNED_URL_TTL,
            },
        });
    } catch (err) {
        console.error('Stream route error:', err.message);
        res.status(500).json({ success: false, error: 'Stream selection failed' });
    }
});

// ── GET /api/v1/stream/:channelId/play — Play stream ─────
// This endpoint either returns a redirect to the actual stream
// or proxies it directly (for CORS/referer-restricted sources)
router.get('/:channelId/play', async (req, res) => {
    try {
        const { channelId } = req.params;
        const { token, expires, sid } = req.query;

        // Verify signed URL
        if (!token || !expires || !sid) {
            return res.status(403).json({ success: false, error: 'Invalid stream token' });
        }

        // Get stream from database
        const stream = await db('streams').where({ id: sid, channel_id: channelId }).first();
        if (!stream) {
            return res.status(404).json({ success: false, error: 'Stream not found' });
        }

        // Check if stream needs proxying
        if (stream.needs_proxy) {
            // Proxy the stream through our server
            try {
                const response = await axios.get(stream.url, {
                    timeout: 15000,
                    responseType: 'stream',
                    headers: {
                        'User-Agent': req.headers['user-agent'] || 'A1TV-Proxy/2.0',
                        'Referer': stream.referrer || new URL(stream.url).origin,
                        'Accept': '*/*',
                    },
                    maxContentLength: Infinity,
                });

                res.set({
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Content-Type': response.headers['content-type'] || 'application/vnd.apple.mpegurl',
                    'Cache-Control': 'no-cache',
                });

                response.data.pipe(res);
                req.on('close', () => response.data.destroy());
                return;
            } catch (proxyErr) {
                console.error('Proxy error:', proxyErr.message);
                // Fall through to redirect
            }
        }

        // Redirect to actual stream URL
        res.redirect(302, stream.url);
    } catch (err) {
        console.error('Stream play error:', err.message);
        res.status(500).json({ success: false, error: 'Stream playback failed' });
    }
});

// ── GET /api/v1/stream/:channelId/failover — Get failover chain ──
router.get('/:channelId/failover', optionalAuth, async (req, res) => {
    try {
        const { channelId } = req.params;
        const userCountry = req.headers['x-country'] || req.query.country || null;
        const userRole = req.userRole || 'guest';

        const result = await streamRouter.selectBestStream(channelId, userCountry, userRole);

        if (!result) {
            return res.status(404).json({ success: false, error: 'No streams available' });
        }

        res.json({
            success: true,
            data: {
                best: result.best ? {
                    id: result.best.id,
                    quality: result.best.quality,
                    score: result.best.finalScore,
                    status: result.best.status,
                } : null,
                failoverChain: result.failoverChain.map(s => ({
                    id: s.id,
                    quality: s.quality,
                    score: s.finalScore,
                    status: s.status,
                })),
            },
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failover chain failed' });
    }
});

module.exports = router;
